// Заглушка для HandlerTyping
// Этот файл нужен для запуска сервера

module.exports = function registerTyping(io) {
  console.log('HandlerTyping loaded as stub');
  
  // Заглушки для typing events
  return {
    handleTyping: () => {
      console.log('Typing handler requested (stub)');
    }
  };
};