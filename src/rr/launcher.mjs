import { call, launchInput, navigate, launchFailure } from './client.mjs';
const box = document.getElementById('rr-launch-status');
async function start() {
  box.textContent = 'Проверяем доступ и выбираем релиз…';
  try {
    const result = await call('rrGetLaunch', launchInput());
    if (result.admin) { navigate('/admin.html'); return; }
    if (!/^\/games\/[a-z0-9_-]+\/[a-f0-9]{16}\/index\.html$/.test(result.game?.entry || '')) throw new Error('Сервер вернул некорректный путь сборки.');
    // Pin the exact release. A concurrent change of the default must not change this party.
    navigate(result.game.entry, { release: result.release.id });
  } catch (e) { launchFailure(box,e,start); }
}
start();
