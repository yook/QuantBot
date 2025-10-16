// Заглушка для HandlerIntegrations
// Этот файл нужен для запуска сервера

module.exports = function registerIntegrations(io) {
  console.log('HandlerIntegrations loaded as stub');
  
  // Заглушки для integrations events
  return {
    handleIntegrations: () => {
      console.log('Integrations handler requested (stub)');
    }
  };
};