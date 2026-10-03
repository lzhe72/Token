import fs from 'node:fs';
import { runAutomaticInstall, type InstallRequest } from './update-install';

async function main(): Promise<void> {
  const requestFile = process.argv[2];
  if (!requestFile) throw new Error('缺少更新请求');
  let request: InstallRequest;
  try { request = JSON.parse(fs.readFileSync(requestFile, 'utf8')) as InstallRequest; }
  finally { try { fs.unlinkSync(requestFile); } catch { /* already removed */ } }
  await runAutomaticInstall(request);
}

void main().catch(error => {
  console.error(`Token 自动更新失败：${error instanceof Error ? error.message : '未知错误'}`);
  process.exitCode = 1;
});
