// Заглушка для HandlerCategories
// Этот файл нужен для запуска сервера

module.exports = function registerCategories(io) {
  console.log('HandlerCategories loaded as stub');
  
  // Заглушки для categories events
  return {
    handleCategories: () => {
      console.log('Categories handler requested (stub)');
    }
  };
};