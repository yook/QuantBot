import { createI18n } from 'vue-i18n'

// Define your locale messages
const messages = {
  en: {
    common: {
      save: 'Save',
      name: 'Name',
      url: 'URL',
    },
    footer: {
      clearCache: 'Clear cache',
    },
    menu: {
      crawling: 'Crawling',
      keywords: 'Keywords',
      virtualTable: 'Virtual Table',
      settings: 'Settings',
    },
    header: {
      selectProject: 'Select project',
      noProjects: 'No projects found',
      addProjectButton: 'Add project',
    },
    addProject: {
      title: 'Add new project',
      namePlaceholder: 'site.com',
      urlPlaceholder: 'https://www.site.com',
      validations: {
        nameRequired: 'Project name is required',
        urlRequired: 'URL is required',
        urlInvalid: 'Enter a valid URL',
      },
    },
    settings: {
      title: 'Settings',
      general: 'General Settings',
      additional: 'Additional Settings',
      projectName: 'Project Name',
      deleteProject: 'Delete project',
      confirmDelete: 'Are you sure you want to delete this project? All project data will be permanently deleted.',
      confirmDeleteTitle: 'Confirm project deletion',
      confirmButton: 'Delete project',
      cancel: 'Cancel',
      inDevelopment: 'Settings in development',
    },
  },
  ru: {
    common: {
      save: 'Сохранить',
      name: 'Название',
      url: 'URL',
    },
    footer: {
      clearCache: 'Очистить кэш',
    },
    menu: {
      crawling: 'Краулинг',
      keywords: 'Ключевые слова',
      virtualTable: 'Виртуальная таблица',
      settings: 'Настройки',
    },
    header: {
      selectProject: 'Выберите проект',
      noProjects: 'Проекты не найдены',
      addProjectButton: 'Новый проект',
    },
    addProject: {
      title: 'Добавить новый проект',
      namePlaceholder: 'site.com',
      urlPlaceholder: 'https://www.site.com',
      validations: {
        nameRequired: 'Имя проекта обязательно',
        urlRequired: 'URL обязателен',
        urlInvalid: 'Введите корректный URL',
      },
    },
    settings: {
      title: 'Настройки',
      general: 'Общие настройки',
      additional: 'Дополнительные настройки',
      projectName: 'Название проекта',
      deleteProject: 'Удалить проект',
      confirmDelete: 'Вы уверены, что хотите удалить этот проект? Все данные проекта будут безвозвратно удалены.',
      confirmDeleteTitle: 'Подтверждение удаления проекта',
      confirmButton: 'Удалить проект',
      cancel: 'Отмена',
      inDevelopment: 'Настройки в разработке',
    },
  },
}

export const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'en',
  globalInjection: true,
  messages,
})

export type MessageSchema = typeof messages
