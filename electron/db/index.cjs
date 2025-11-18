/* Central facade for DB modules. CommonJS so workers can require it. */
const dbModule = require("./adapter.cjs");
const projects = require("./projects.cjs");
const keywords = require("./keywords.cjs");
const stopwords = require("./stopwords.cjs");
const typing = require("./typing.cjs");
const embeddings = require("./embeddings.cjs");
const categories = require("./categories.cjs");

module.exports = {
  // raw DB exports
  db: dbModule.db,
  dbPath: dbModule.dbPath,
  dbGet: dbModule.dbGet,
  dbAll: dbModule.dbAll,
  dbRun: dbModule.dbRun,
  // domain modules
  projects,
  keywords,
  stopwords,
  typing,
  embeddings,
  categories,
  // compatibility named exports (legacy socket/db-sqlite API)
  // raw helpers
  dbGet: dbModule.dbGet,
  dbAll: dbModule.dbAll,
  dbRun: dbModule.dbRun,
  // embeddings cache + typing model
  embeddingsCacheGet: embeddings.embeddingsCacheGet,
  embeddingsCachePut: embeddings.embeddingsCachePut,
  updateTypingSampleEmbeddings: embeddings.updateTypingSampleEmbeddings,
  getTypingModel: embeddings.getTypingModel,
  upsertTypingModel: embeddings.upsertTypingModel,
  // categories
  categoriesInsertBatch: categories.categoriesInsertBatch,
  // keywords stop-words
  keywordsApplyStopWords: keywords.applyStopWords,
};
