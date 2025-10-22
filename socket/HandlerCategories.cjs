// Заглушка для HandlerCategories
// Этот файл нужен для запуска сервера

module.exports = function registerCategories(io, socket) {
  console.log(
    "HandlerCategories loaded as stub for socket:",
    socket && socket.id
  );
  // Заглушки для categories events
  // If needed, bind event handlers to socket here.
  return {
    handleCategories: () => {
      console.log("Categories handler requested (stub)");
    },
  };
};
