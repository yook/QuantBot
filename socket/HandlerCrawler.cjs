// Заглушка для HandlerCrawler
// Этот файл нужен для запуска сервера

module.exports = function registerCrawler(io) {
  console.log('HandlerCrawler loaded as stub');
  
  // Заглушки для crawler events
  return {
    startCrawler: () => {
      console.log('Crawler start requested (stub)');
    },
    stopCrawler: () => {
      console.log('Crawler stop requested (stub)');
    }
  };
};