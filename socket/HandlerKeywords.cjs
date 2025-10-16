// Заглушка для HandlerKeywords
// Этот файл нужен для запуска сервера

module.exports = function registerKeywords(io) {
  console.log('HandlerKeywords loaded as stub');
  
  // Заглушки для keywords events
  return {
    handleKeywords: () => {
      console.log('Keywords handler requested (stub)');
    }
  };
};