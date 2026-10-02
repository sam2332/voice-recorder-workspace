// Wiring buttons and page-wide events.
import type { AnyEl } from './core/dom';
import { $, RATES, audio } from './core/dom';
import { state } from './core/state';
import { isReady, libItem } from './day/helpers';
import { openDay } from './day/open';
import { playRaw, updateActiveSource } from './day/recordings';
import { closeDrawers, openDrawer } from './drawers';
import { exportTxt } from './export';
import { ingest } from './file-mode';
import { showHome } from './home/home';
import { go, refreshLibrary, stepDay } from './library/library';
import { transcribe } from './library/queue';
import { showMeetings } from './meetings/page';
import { showOverview } from './overview/data';
import { showPeople } from './people/page';
import { savePosition, seek, setAudio, setRate, togglePlay } from './player/audio';
import { syncActive, updateJump, updateNow, updatePlayIcon, updateProgress } from './player/sync';
import { openVoiceReview } from './review/dialog';
import { askTranscribe } from './transcribe/dialog';
import { editLines } from './transcript/edit';
import { renderTranscript } from './transcript/render';
import { store } from './util/store';
import { toast } from './util/toast';

export function init(): void {
  $('open-folder').onclick = () => $('folder-input').click();
  $('open-files').onclick = () => $('files-input').click();
  $('close-btn').onclick = () => $('folder-input').click();
  $('folder-input').onchange = e => { ingest([...(e.target as AnyEl).files]); (e.target as AnyEl).value = ''; };
  $('files-input').onchange = e => { ingest([...(e.target as AnyEl).files]); (e.target as AnyEl).value = ''; };
  $('export-btn').onclick = exportTxt;
  $('help-btn').onclick = () => $('help-dlg').showModal();
  $('library-toggle').onclick = () => openDrawer('library');
  $('details-toggle').onclick = () => openDrawer('details');
  $('scrim').onclick = closeDrawers;
  $('prev-day').onclick = () => stepDay(-1);
  $('next-day').onclick = () => stepDay(1);
  $('refresh-btn').onclick = () => refreshLibrary(false);
  $('lib-home').onclick = () => go('');
  $('lib-people').onclick = () => { go('people'); closeDrawers(); };
  $('lib-overview').onclick = () => { go('overview'); closeDrawers(); };
  $('lib-meetings').onclick = () => { go('meetings'); closeDrawers(); };
  $('brand').onclick = () => state.server && go('');
  $('brand').onkeydown = e => { if (e.key === 'Enter') $('brand').onclick(null); };
  $('process-all').onclick = () => transcribe(state.library.filter(d => d.status === 'pending' && !d.job).map(d => d.date).reverse());
  $('banner-btn').onclick = () => askTranscribe('Re-transcribe');
  $('redo-btn').onclick = () => askTranscribe('Re-transcribe');
  $('review-btn').onclick = () => { $('voices-dlg').returnValue = ''; openVoiceReview(); };
  $('process-dlg').addEventListener('input', e => {
    if ((e.target as AnyEl).type === 'number') (e.target as AnyEl).closest('label').querySelector<HTMLInputElement>('input[type=radio]').checked = true;
  });
  // The paused-queue dialog can't be dismissed with Esc: a choice is required
  $('process-dlg').addEventListener('cancel', e => { if ($('process-dlg').classList.contains('blocked')) e.preventDefault(); });
  $('lib-list').addEventListener('click', e => {
    const card = (e.target as AnyEl).closest<HTMLElement>('.day-card');
    if (card) { go(card.dataset.date); closeDrawers(); }
  });
  window.addEventListener('hashchange', () => {
    const d = decodeURIComponent(location.hash.slice(1));
    if (!d) { if (state.server && state.view !== 'home') showHome(); }
    else if (d === 'people') { if (state.view !== 'people') showPeople(); }
    else if (d === 'overview') { if (state.view !== 'overview') showOverview(); }
    else if (d === 'meetings') { if (state.view !== 'meetings') showMeetings(); }
    else if (d !== state.date && libItem(d)) openDay(d);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLibrary(); });

  $('audio-skip').onclick = () => $('audio-dlg').close();
  $('audio-pick').onclick = () => $('audio-input').click();
  $('audio-input').onchange = e => {
    const f = (e.target as AnyEl).files[0]; (e.target as AnyEl).value = '';
    if (!f) return;
    state.files[state.date].audio = f;
    $('audio-dlg').close();
    setAudio(f);
  };

  $('noise-toggle').onclick = () => { state.showNoise = !state.showNoise; renderTranscript(); };
  $('noise-trash').onclick = () => editLines('trash', state.segments.filter(s => s.noise));
  $('play').onclick = togglePlay;
  $('back').onclick = () => seek(audio.currentTime - 10);
  $('fwd').onclick = () => seek(audio.currentTime + 10);
  $('rate').onclick = () => setRate(RATES[(RATES.indexOf(audio.playbackRate) + 1) % RATES.length] || 1);
  $('vol').oninput = e => { audio.volume = +(e.target as AnyEl).value; store.set('vol', audio.volume); };
  $('jump').onclick = () => { state.userScrolledAt = 0; document.querySelector('.cue.active')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  $('follow').onchange = () => { state.userScrolledAt = 0; syncActive(true); };

  $('transcript').addEventListener('click', e => {
    const cue = (e.target as AnyEl).closest<HTMLElement>('.cue');
    if (cue) seek(state.segments[+cue.dataset.i].start, true);
  });
  // Pause auto-follow briefly when the user scrolls the transcript themselves
  ['wheel', 'touchmove'].forEach(t => $('transcript').addEventListener(t, () => state.userScrolledAt = Date.now(), { passive: true }));
  $('transcript').addEventListener('scroll', () => updateJump(), { passive: true });

  audio.addEventListener('timeupdate', () => { updateProgress(); syncActive(); updateActiveSource(); updateNow(); });
  audio.addEventListener('play', () => { updatePlayIcon(); syncActive(true); });
  audio.addEventListener('pause', () => { updatePlayIcon(); savePosition(); syncActive(true); });
  audio.addEventListener('ended', () => {
    updatePlayIcon();
    // Raw recordings play back to back
    if (!isReady() && state.rawIdx >= 0 && state.rawIdx < state.sources.length - 1) playRaw(state.rawIdx + 1);
  });
  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('error', () => { if (audio.getAttribute('src')) toast("Couldn't play that audio file."); });
  window.addEventListener('beforeunload', savePosition);
  setInterval(() => { if (!audio.paused) savePosition(); }, 5000);
}
