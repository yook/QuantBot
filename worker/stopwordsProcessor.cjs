#!/usr/bin/env node
// Worker: import stop words in batches and optionally apply them to keywords
// Usage: node worker/stopwordsProcessor.cjs --config=path/to/config.json
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function log(obj){
  try{ process.stdout.write(JSON.stringify(obj)+'\n'); }catch(_){ }
}

function parseArgs(){
  const args = process.argv.slice(2);
  const cfgArg = args.find(a=>a.startsWith('--config='));
  const cfgPath = cfgArg ? cfgArg.split('=')[1] : null;
  if(!cfgPath || !fs.existsSync(cfgPath)){
    log({type:'error', message:'Config file not found', cfgPath});
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(cfgPath,'utf8'));
}

async function main(){
  const cfg = parseArgs();
  const { dbPath, projectId, stopWords = [], applyToKeywords = true, batchSize = 500 } = cfg;
  if(!dbPath || !projectId){ log({type:'error', message:'Missing dbPath or projectId'}); process.exit(1); }

  let db;
  try{ db = new Database(dbPath); }catch(e){ log({type:'error', message:'DB open error', error:e.message}); process.exit(1); }

  // Normalize words
  const normalized = stopWords
    .map(s=>String(s||'').trim())
    .filter(s=>s.length>0)
    .map(s=>s.toLowerCase());

  const total = normalized.length;
  log({type:'started', total});

  if(total===0){ log({type:'finished', inserted:0}); process.exit(0); }

  // Prepared statements
  const insertStmt = db.prepare('INSERT OR IGNORE INTO stop_words (project_id, word) VALUES (?, ?)');
  const insertTxn = db.transaction((rows)=>{ for(const w of rows) insertStmt.run(projectId, w); });

  // Insert in batches
  let inserted = 0;
  for(let i=0;i<total;i+=batchSize){
    const chunk = normalized.slice(i, i+batchSize);
    try{ insertTxn(chunk); inserted += chunk.length; }
    catch(e){ log({type:'warn', message:'insert batch failed', error:e.message}); }
    const progress = Math.round(Math.min(100, (i+chunk.length)/total*50));
    log({type:'progress', stage:'insert', inserted:Math.min(inserted,total), total, percent:progress});
  }

  // Optionally apply stopwords to keywords: mark keywords that contain any stopword
  let applied = 0;
  if(applyToKeywords){
    try{
      const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM keywords WHERE project_id = ?').get(projectId);
      const totalKeywords = (countRow && countRow.cnt) || 0;
      const selectStmt = db.prepare('SELECT id, keyword FROM keywords WHERE project_id = ? LIMIT ? OFFSET ?');
      const updateStmt = db.prepare('UPDATE keywords SET is_stop = 1 WHERE id = ?');

      const stopSet = new Set(normalized);
      const kBatch = 1000;
      for(let off=0; off<totalKeywords; off+=kBatch){
        const rows = selectStmt.all(projectId, kBatch, off);
        for(const r of rows){
          const kw = String(r.keyword||'').toLowerCase();
          // simple substring check; short-circuit on first match
          for(const stop of stopSet){
            if(!stop) continue;
            if(kw.includes(stop)){
              try{ updateStmt.run(r.id); applied++; }catch(_){ }
              break;
            }
          }
        }
        const pct = 50 + Math.round(Math.min(100, (off + rows.length)/Math.max(1,totalKeywords)*50));
        log({type:'progress', stage:'apply', processed: Math.min(off+rows.length,totalKeywords), totalKeywords, applied, percent:pct});
      }
    }catch(e){ log({type:'error', stage:'apply', message:e.message}); }
  }

  log({type:'finished', inserted: total, applied});
  process.exit(0);
}

main().catch(e=>{ log({type:'error', message:e.message}); process.exit(1); });
