// Entry point: wires every module, then loads the library (server) or waits for a folder (file mode).
import { $, audio } from './core/dom';
import { state } from './core/state';
import { loadSettings } from './home/settings';
import { refreshSync } from './home/sync';
import { refreshLibrary } from './library/library';
import { setRate } from './player/audio';
import { api } from './util/api';
import { store } from './util/store';
import { init as init_review_snippets } from './review/snippets';
import { init as init_review_dialog } from './review/dialog';
import { init as init_teach_dialog } from './teach/dialog';
import { init as init_split_actions } from './split/actions';
import { init as init_events } from './events';
import { init as init_transcribe_preview } from './transcribe/preview';
import { init as init_file_mode } from './file-mode';
import { init as init_player_timeline } from './player/timeline';
import { init as init_search } from './search';
import { init as init_keyboard } from './keyboard';

init_review_snippets();
init_review_dialog();
init_teach_dialog();
init_split_actions();
init_events();
init_transcribe_preview();
init_file_mode();
init_player_timeline();
init_search();
init_keyboard();
// Restore preferences
setRate(store.get('rate', 1));
audio.volume = store.get('vol', 1);
$('vol').value = String(audio.volume);

// When served by app.py, load the library straight from the server
if (location.protocol.startsWith('http')) {
  document.body.classList.add('server');  // avoid flashing the folder picker while loading
  api('/api/library').then(() => { state.server = true; loadSettings(); refreshSync(); refreshLibrary(); })
    .catch(() => document.body.classList.remove('server'));
}
