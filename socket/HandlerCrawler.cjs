const {
  db,
  dbGet,
  dbAll,
  dbRun,
  updateProjectStatus,
  getProjectStatus,
  isUrlDisallowed,
  isUrlProcessed,
  getProjectStats,
  updateProjectQueueStats,
  getProjectQueueSize,
  saveError,
  saveData,
} = require("./db-sqlite.cjs");
const { app } = require("electron");
const path = require("path");
const Crawler = require("simplecrawler");
const cheerio = require("cheerio");
const { log } = require("util");
const fs = require("fs");

// Определяем путь к файлу очереди
const queuePath = (id) => {
  return app
    ? path.join(app.getPath("userData"), "/db/" + id + "/queue")
    : "./db/" + id + "/queue";
};

const getProp = (data, getLength, selector, find, attrClass) => {
  let $ = cheerio.load(data.toString("utf8"));
  if (find === "text" && !getLength)
    return $(selector)
      .map((i, el) => {
        return $(el).text().trim();
      })
      .get()
      .join("; ");
  if (find === "text" && getLength)
    return $(selector).text() === undefined ? 0 : $(selector).text().length;
  if (find === "attr" && !getLength)
    return $(selector)
      .map((i, el) => {
        return $(el).attr(attrClass);
      })
      .get()
      .join("; ");

  if (find === "attr" && getLength)
    return $(selector).attr(attrClass) === undefined
      ? 0
      : $(selector).attr(attrClass).length;
  if (find === "hasClass" && !getLength)
    return $(selector).hasClass(attrClass) + "";
  if (find === "hasClass" && getLength)
    return $(selector).hasClass(attrClass) === undefined
      ? 0
      : $(selector).hasClass(attrClass).length;
  if (find === "quantity") return $(selector).length;
};

const note = (queueItem) => {
  return {
    url: queueItem.url,
    referrer: queueItem.referrer,
    code: queueItem.stateData.code,
    depth: queueItem.depth,
    status: queueItem.status,
    protocol: queueItem.protocol,
    requestTime: queueItem.stateData.requestTime,
    downloadTime: queueItem.stateData.downloadTime,
    requestLatency: queueItem.stateData.requestLatency,
    contentType: queueItem.stateData.contentType,
    actualDataSize: queueItem.stateData.actualDataSize,
    date: queueItem.stateData.headers.date,
  };
};

const getContent = (responseBuffer, parser) => {
  // Парсинг элементов страницы по селекторам
  let res = {};

  if (!parser || !responseBuffer) return res;

  try {
    // Проходим по всем определенным селекторам
    Object.keys(parser).forEach((key) => {
      const { prop, selector, find, attrClass, getLength } = parser[key];
      if (selector && find && prop) {
        res[prop] = getProp(
          responseBuffer,
          getLength,
          selector,
          find,
          attrClass
        );
      }
    });
  } catch (error) {
    // Обработка ошибок парсинга
  }

  return res;
};

module.exports = (io, socket) => {
  let crawler = null;
  let isDefrosting = false;
  let isFreezingInProgress = false;

  // Безопасная остановка краулера с упрощенной логикой
  const safeCrawlerStop = async (projectId, reason = "manual") => {
    if (isFreezingInProgress) {
      socket.emit("stopping", { message: "Остановка уже в процессе" });
      return false;
    }

    isFreezingInProgress = true;

    // Эмитим начало процесса остановки
    socket.emit("stopping", {
      message: "Начинаем остановку краулера...",
      reason: reason,
    });

    try {
      // 1. Проверяем существование краулера
      if (!crawler) {
        // Обновляем статус в БД как заморожен
        await updateProjectStatus(projectId, true);

        socket.emit("stopped", {
          message: "Краулер не был запущен",
          freezed: true,
        });
        return true;
      }

      // 2. Проверяем состояние краулера
      if (!crawler.running) {
        socket.emit("stopping", {
          message: "Краулер уже остановлен, выполняем заморозку...",
        });
      } else {
        socket.emit("stopping", {
          message: "Останавливаем процесс краулинга...",
        });

        crawler.stop();

        // Ждем немного чтобы краулер успел остановиться
        // await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // 3. Проверяем очередь
      if (!crawler.queue) {
        // Обновляем статус в БД как заморожен
        await updateProjectStatus(projectId, true);

        socket.emit("stopped", {
          message: "Очередь не была инициализирована",
          freezed: true,
        });
        return true;
      }

      // 4. Сохраняем состояние очереди
      socket.emit("stopping", { message: "Сохраняем состояние очереди..." });

      // Получаем и сохраняем размер очереди до заморозки
      const queueSize = await getQueueSize();
      // Логируем сохранение размера очереди перед заморозкой
      try {
        console.log(
          `[queue] ${new Date().toISOString()} save-before-freeze projectId=${projectId} queue=${queueSize}`
        );
      } catch (e) {}
      await updateProjectQueueStats(projectId, queueSize, socket);

      const queueFilePath = queuePath(projectId);

      // Создаем директорию, если она не существует
      const queueDir = path.dirname(queueFilePath);
      if (!fs.existsSync(queueDir)) {
        fs.mkdirSync(queueDir, { recursive: true });
      }

      // Сохраняем очередь
      let success = false;
      try {
        await new Promise((resolve) => {
          crawler.queue.freeze(queueFilePath, (error) => {
            if (error) {
              console.error("Ошибка при сохранении очереди:", error);
              resolve(false);
            } else {
              resolve(true);
            }
            success = !error;
          });
        });
      } catch (freezeError) {
        console.error("Ошибка при сохранении очереди:", freezeError);
        success = false;
      }

      // Обновляем статус в БД как заморожен
      await updateProjectStatus(projectId, true); // Отправляем результат клиенту
      if (success) {
        socket.emit("stopped", {
          message: "Остановка успешно завершена",
          freezed: true,
        });
        return true;
      } else {
        socket.emit("stopped", {
          message: "Остановка завершена с ошибками сохранения очереди",
          freezed: true,
        });
        return false;
      }
    } catch (error) {
      console.error("Ошибка при остановке краулера:", error);

      // Обновляем статус в БД как заморожен (даже при ошибке)
      await updateProjectStatus(projectId, true);

      socket.emit("stopped", {
        message: "Остановка завершена с критической ошибкой",
        freezed: true,
        error: error.message,
      });
      return false;
    } finally {
      isFreezingInProgress = false;
    }
  };

  const qeueStatus = async (projectId = null) => {
    if (
      !crawler ||
      !crawler.queue ||
      typeof crawler.queue.countItems !== "function"
    ) {
      return;
    }
    // Не отправляем queue если краулер не запущен (чтобы не было моргания 0)
    if (!crawler.running) {
      return;
    }
    const queueSize = await getQueueSize();
    try {
      console.log(
        `[queue] ${new Date().toISOString()} emit-from-qeueStatus projectId=${projectId} queue=${queueSize}`
      );
    } catch (e) {}
    socket.emit("queue", { queue: queueSize, projectId: projectId });
  };

  // Получение размера очереди (работает для активного и остановленного краулера)
  const getQueueSize = async () => {
    if (
      !crawler ||
      !crawler.queue ||
      typeof crawler.queue.countItems !== "function"
    ) {
      return 0;
    }

    // Возвращаем Promise с количеством элементов
    return new Promise((resolve) => {
      crawler.queue.countItems({ fetched: false }, (error, count) => {
        if (error) {
          resolve(0);
        } else {
          resolve(count || 0);
        }
      });
    });
  };

  // Проверка статистики очереди и эмиттинг fetched
  const checkQueueFileAndEmitStats = async (projectId) => {
    try {
      const stats = await getProjectStats(projectId);

      // Эмитим fetched со значением из статистики
      if (stats && typeof stats.html === "number") {
        const fetchedCount =
          stats.html + stats.jscss + stats.image + stats.redirect + stats.error;
        socket.emit("fetched", { fetched: fetchedCount, projectId: projectId });
      }
    } catch (error) {
      console.error("Ошибка при проверке статистики очереди:", error);
    }
  };

  // Функция очистки восстановленной очереди от уже обработанных URL
  const cleanupRestoredQueue = async (projectId) => {
    if (
      !crawler ||
      !crawler.queue ||
      typeof crawler.queue.countItems !== "function"
    ) {
      return { totalCount: 0, removedCount: 0, finalCount: 0 };
    }

    let removedCount = 0;
    let totalCount = 0;

    // Получаем общее количество элементов в очереди
    await new Promise((resolve) => {
      crawler.queue.countItems({}, (error, count) => {
        if (error) {
          totalCount = 0;
        } else {
          totalCount = count || 0;
        }
        resolve();
      });
    });

    // Если очередь пуста, ничего не делаем
    if (totalCount === 0) {
      return { totalCount: 0, removedCount: 0, finalCount: 0 };
    }

    return { totalCount, removedCount, finalCount: totalCount - removedCount };
  };

  // HANDLERS

  socket.on("stopCrauler", async (projectId) => {
    await safeCrawlerStop(projectId, "manual");

    // После остановки краулера проверяем файл очереди и эмитим статистику
    await checkQueueFileAndEmitStats(projectId);
  });

  // Разморозка краулера
  const defrostCrawler = async (project) => {
    if (isDefrosting) return;

    isDefrosting = true;

    const queueFilePath = queuePath(project.id);

    // Инициализируем новый краулер в любом случае
    crawler = new Crawler(project.url);

    if (fs.existsSync(queueFilePath)) {
      // Защита от нулевого по длине файла очереди: удаляем его и логируем
      try {
        const stats = fs.statSync(queueFilePath);
        if (stats.size === 0) {
          try {
            fs.unlinkSync(queueFilePath);
            console.log(
              `[queue] ${new Date().toISOString()} removed zero-length queue file for project=${
                project.id
              }`
            );
          } catch (unlinkErr) {
            console.warn(
              `Failed to remove zero-length queue file ${queueFilePath}:`,
              unlinkErr
            );
          }
        }
      } catch (statErr) {
        // ignore stat errors and continue
      }
      // Размораживаем очередь
      try {
        await new Promise((resolve, reject) => {
          crawler.queue.defrost(queueFilePath, (err) => {
            if (err) {
              console.error("Ошибка при разморозке очереди:", err);
              reject(err);
            } else {
              // Эмитим статистику
              qeueStatus(project.id);
              // Проверяем статистику и эмитим fetched
              checkQueueFileAndEmitStats(project.id);
              resolve();
            }
          });
        });
      } catch (err) {
        console.error("Ошибка при разморозке очереди:", err);
      } finally {
        isDefrosting = false;
      }
    } else {
      // Создаем папку если её нет
      const queueDir = path.dirname(queueFilePath);
      fs.mkdirSync(queueDir, { recursive: true });

      // Даем время новой очереди инициализироваться
      setTimeout(() => {
        qeueStatus(project.id);
      }, 100);

      isDefrosting = false;
    }
  };

  socket.on("getQeue", async (project) => {
    // Если краулер заморожен или не инициализирован, разморозим его
    if (project.freezed || !crawler) {
      await defrostCrawler(project);
    }

    // Попробуем получить размер очереди напрямую
    let queueSize = 0;

    if (
      crawler &&
      crawler.queue &&
      typeof crawler.queue.countItems === "function"
    ) {
      // Если краулер активен, получаем текущий размер очереди
      queueSize = await getQueueSize();
    } else {
      // Если краулер не активен или его очередь недоступна,
      // получаем сохраненный размер очереди из БД
      queueSize = await getProjectQueueSize(project.id);
    }

    // Отправляем актуальное значение очереди
    socket.emit("queue", { queue: queueSize, projectId: project.id });
  });

  socket.on("startCrauler", async (project) => {
    if (!project || !project.id || !project.url) {
      console.error("Invalid project data for crawler:", project);
      return;
    }

    // Проверяем наличие файла очереди
    const queueFilePath = queuePath(project.id);
    const hasQueueFile = fs.existsSync(queueFilePath);

    // Проверяем статус проекта в базе данных
    try {
      const dbStatus = await getProjectStatus(project.id);

      if (dbStatus && dbStatus.freezed) {
        project.freezed = true; // Обновляем локальный статус
      } else if (dbStatus && !hasQueueFile) {
        project.freezed = false;
      } else if (hasQueueFile) {
        project.freezed = true; // Принудительно восстанавливаем из файла
      }
    } catch (error) {
      console.error("Ошибка при проверке статуса проекта:", error);

      // Если есть файл очереди, все равно пытаемся восстановить
      if (hasQueueFile) {
        project.freezed = true;
      }
    }

    if (project.freezed || !crawler) {
      await defrostCrawler({ ...project, id: project.id });
    } else {
      crawler = new Crawler(project.url);
    }

    // Проверяем, что crawler инициализирован
    if (!crawler) {
      console.error("Ошибка: crawler не был инициализирован");
      return;
    }

    const config = project.crawler;
    const parser = project.parser;

    crawler.maxDepth = config.maxDepth;
    crawler.maxConcurrency = config.maxConcurrency;
    crawler.interval = config.interval;
    crawler.timeout = config.timeout;
    crawler.parseScriptTags = config.parseScriptTags;
    crawler.stripQuerystring = config.stripQuerystring;
    crawler.sortQueryParameters = config.sortQueryParameters;
    crawler.respectRobotsTxt = config.respectRobotsTxt;
    crawler.scanSubdomains = config.scanSubdomains;
    crawler.userAgent = config.userAgent;

    if (!config.parseScriptTags) {
      crawler.supportedMimeTypes.splice(0, 1, /^text\/html/i);
      crawler.supportedMimeTypes.splice(2, 1);
    }

    if (config.parseImages) crawler.supportedMimeTypes.push(/^image\//i);
    crawler.ignoreInvalidSSL = true;
    crawler.downloadUnsupported = false;

    // Добавляем начальный URL в очередь только если это новый краулер (не defrost)
    if (!project.freezed) {
      crawler.queueURL(project.url);
    }

    // Обновляем статус проекта как не заморожен (активен)
    await updateProjectStatus(project.id, false);

    // Добавляем фильтр для предотвращения повторной обработки URL
    crawler.addFetchCondition(async (queueItem, referrer) => {
      // Проверяем, не заблокирован ли URL
      const isDisallowed = await isUrlDisallowed(project.id, queueItem.url);
      if (isDisallowed) {
        return false; // Пропускаем заблокированные URL
      }

      // Проверяем, не обработан ли URL уже
      const isProcessed = await isUrlProcessed(project.id, queueItem.url);
      if (isProcessed) {
        return false; // Пропускаем уже обработанные URL
      }

      return true; // Разрешаем обработку нового URL
    });

    socket.on("disconnect", async () => {
      await safeCrawlerStop(project.id, "disconnect");
    });

    socket.on("freezeQueue", async () => {
      await safeCrawlerStop(project.id, "manual");
    });

    crawler.on("fetchcomplete", (queueItem, responseBuffer) => {
      let obj = {
        ...note(queueItem),
        ...getContent(responseBuffer, parser),
      };

      // Сохраняем все HTTP коды в таблицу urls (успешные и ошибочные)
      const responseCode = obj.code;

      if (obj.contentType.includes("image")) {
        obj.type = "image";
        saveData("urls", project.id, obj, socket);
      } else if (
        obj.contentType.includes("javascript") ||
        obj.contentType.includes("css")
      ) {
        obj.type = "jscss";
        saveData("urls", project.id, obj, socket);
      } else if (
        obj.contentType.includes("html") ||
        obj.contentType.includes("text/html") ||
        obj.contentType.includes("application/xhtml")
      ) {
        obj.type = "html";
        saveData("urls", project.id, obj, socket);
      } else {
        obj.type = "other";
        saveData("urls", project.id, obj, socket);
      }

      // Оставляем qeueStatus только для статистики очереди
      qeueStatus(project.id);
    });

    crawler.on("fetchstart", (queueItem, requestOptions) => {});

    crawler.on("queueadd", (queueItem, referrer) => {
      qeueStatus(project.id);
    });

    crawler.on("fetchredirect", (queueItem, redirectQueueItem, response) => {
      const responseCode = response ? response.statusCode : 0;
      let obj = { ...note(queueItem), type: "redirect" };
      saveData("urls", project.id, obj, socket);
    });

    crawler.on("fetch404", (queueItem, response) => {
      const responseCode = response ? response.statusCode : 404;
      let obj = { ...note(queueItem), type: "error" };
      saveData("urls", project.id, obj, socket);
    });

    crawler.on("fetcherror", async (queueItem, response) => {
      const responseCode = response ? response.statusCode : 0;

      // Если это сетевая ошибка (code = 0), сохраняем в таблицу disallowed
      if (responseCode === 0) {
        const errorData = {
          url: queueItem.url,
          error_type: "fetcherror",
          code: 0,
          status: queueItem.status,
          referrer: queueItem.referrer,
          depth: queueItem.depth,
          protocol: queueItem.protocol,
          error_message: response
            ? response.message || response.statusMessage
            : "Network connection error",
        };
        await saveError(project.id, errorData, socket);
        return;
      }

      // HTTP ошибки 400-599 сохраняем в urls
      let obj = {
        url: queueItem.url,
        code: response ? response.statusCode : 0,
        status: queueItem.status,
        type: "error",
      };
      saveData("urls", project.id, obj, socket);
    });

    crawler.on("fetchtimeout", (queueItem, timeout) => {
      // fetchtimeout не имеет HTTP кода, timeout - это время в мс
      let obj = {
        url: queueItem.url,
        code: timeout,
        status: queueItem.status,
        type: "fetchtimeout",
      };
      saveData("urls", project.id, obj, socket);
    });

    crawler.on("fetchdisallowed", async (queueItem) => {
      // fetchdisallowed не имеет HTTP кода, это запрет robots.txt - сохраняем в disallowed
      const errorData = {
        url: queueItem.url,
        error_type: "fetchdisallowed",
        code: 0, // robots.txt запрет не имеет HTTP кода
        status: queueItem.status,
        referrer: queueItem.referrer,
        depth: queueItem.depth,
        protocol: queueItem.protocol,
        error_message: "Access disallowed by robots.txt",
      };
      await saveError(project.id, errorData, socket);
    });

    crawler.on("discoverycomplete", (queueItem, responseObject) => {});

    crawler.on("invaliddomain", async (item) => {
      // invaliddomain всегда код 0, это DNS ошибка - сохраняем в disallowed
      const errorData = {
        url: item.url,
        error_type: "invaliddomain",
        code: 0,
        status: item.status,
        referrer: item.referrer,
        depth: item.depth,
        protocol: item.protocol,
        error_message: "Invalid domain - DNS resolution failed",
      };

      await saveError(project.id, errorData, socket);
    });

    crawler.on("complete", async () => {
      isFreezingInProgress = false; // Сбрасываем флаг блокировки
      socket.emit("complete");
    });

    crawler.on("fetchconditionerror", (queueItem, error) => {});

    crawler.on("fetchprevented", (queueItem, fetchCondition) => {});

    crawler.on("queueerror", (error, queueItem) => {});

    crawler.on("queueduplicate", (queueItem) => {});

    crawler.on("fetchclienterror", (queueItem, error) => {});

    crawler.on("cookieerror", (queueItem, error, cookie) => {});

    crawler.on("fetchheaders", (queueItem, response) => {});

    crawler.on("downloadconditionerror", (queueItem, error) => {});

    crawler.on("downloadprevented", (queueItem, error) => {});

    // Дополнительные обработчики
    crawler.on("fetch410", (queueItem, response) => {
      const responseCode = response ? response.statusCode : 410;
      let obj = {
        url: queueItem.url,
        code: response.statusCode,
        status: queueItem.status,
        type: "error",
      };
      saveData("urls", project.id, obj, socket);
    });

    crawler.on("notmodified", (queueItem, response) => {
      const responseCode = response ? response.statusCode : 304;
      let obj = {
        url: queueItem.url,
        code: response.statusCode,
        status: queueItem.status,
        type: "redirect",
      };
      saveData("urls", project.id, obj, socket);
    });

    crawler.on("gziperror", (queueItem, responseBody, response) => {});

    crawler.on("fetchdataerror", (queueItem, response) => {});

    crawler.on("robotstxterror", (error) => {});

    // Обработчик критических ошибок краулера
    crawler.on("error", (error) => {
      isFreezingInProgress = false; // Сбрасываем флаг блокировки
      socket.emit("crawlerError", { message: error.message });
    });

    // Запускаем краулер
    crawler.start();

    // Обновляем статистику
    await checkQueueFileAndEmitStats(project.id);
  });

  return socket;
};
