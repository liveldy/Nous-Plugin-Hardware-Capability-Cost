#!/usr/bin/env node
// 每日快照生成器：把一份上游数据整理成插件随包携带的快照（ui/data.js）。
// 插件页面在宿主 iframe 中不能联网，所以"每天更新的快照"由定时任务在这里生成，
// 再连同插件包一起发布；用户打开插件时读到的就是最近一次快照。
//
// 用法：
//   node tools/snapshot.mjs                      # 用 tools/reference-scores.json
//   node tools/snapshot.mjs --from 文件.json      # 用本机文件
//   node tools/snapshot.mjs --url https://…json   # 用上游接口
//   node tools/snapshot.mjs --date 2026-11-14T03:00:00Z
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : args[i + 1];
};

const from = path.resolve(option('from', path.join(root, 'tools/reference-scores.json')));
const url = option('url');
const out = path.resolve(option('out', path.join(root, 'ui/data.js')));
const stamp = option('date', new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));

async function read(source) {
  if (!source) return JSON.parse(await fs.readFile(from, 'utf8'));
  if (!/^https:\/\//.test(source)) throw new Error('上游接口必须使用 https');
  const response = await fetch(source, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('上游返回 ' + response.status);
  return response.json();
}

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function clean(view, key) {
  if (!view || !Array.isArray(view.items) || view.items.length === 0) {
    throw new Error('缺少 ' + key + ' 数据');
  }
  const seen = new Set();
  const items = view.items.map((item) => {
    const name = String(item.name || '').trim();
    const score = Number(item.score);
    const price = Number(item.price);
    if (!name || !(score > 0) || !(price > 0)) throw new Error(key + ' 条目无效：' + JSON.stringify(item));
    const id = slug(name);
    if (seen.has(id)) throw new Error(key + ' 条目重复：' + name);
    seen.add(id);
    return {
      id,
      name,
      brand: String(item.brand || ''),
      spec: String(item.spec || ''),
      score: Math.round(score),
      price: Math.round(price),
      ref: item.ref === true
    };
  });
  items.sort((a, b) => b.score - a.score);
  return {
    metric: String(view.metric || ''),
    spec: String(view.spec || ''),
    items
  };
}

const raw = await read(url);
const cpu = clean(raw.cpu, 'cpu');
const gpu = clean(raw.gpu, 'gpu');
const snapshot = {
  schema: 'hardware-snapshot/1',
  generatedAt: stamp,
  source: url || path.relative(root, from).replace(/\\/g, '/'),
  cpu,
  gpu
};

const body = [
  '/* 由 tools/snapshot.mjs 生成，勿手改。快照 ' + snapshot.generatedAt + ' */',
  'window.HARDWARE_SNAPSHOT = ' + JSON.stringify(snapshot, null, 1) + ';',
  ''
].join('\n');

await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, body, 'utf8');

const count = (view) => view.items.length;
const estimates = (view) => view.items.filter((item) => item.ref).length;
console.log(JSON.stringify({
  out: path.relative(root, out).replace(/\\/g, '/'),
  generatedAt: snapshot.generatedAt,
  source: snapshot.source,
  cpu: count(cpu) + ' 条（参考值 ' + estimates(cpu) + '）',
  gpu: count(gpu) + ' 条（参考值 ' + estimates(gpu) + '）',
  bytes: Buffer.byteLength(body)
}, null, 2));
