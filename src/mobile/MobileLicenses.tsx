import project from '../../LICENSE?raw';
import dependencies from '../../resources/DEPENDENCY_LICENSES.txt?raw';
import drawings from '../../resources/EXCALIDRAW_LICENSE.txt?raw';
import fonts from '../../resources/FONT_LICENSES.txt?raw';
import diagrams from '../../resources/licenses/DIAGRAM-DEPENDENCIES.txt?raw';
import apache from '../../resources/licenses/TeaVM-Apache.txt?raw';

export default function MobileLicenses(){return <pre className='mobile-licenses'>{[
  'Moyu\n\n'+project,
  'AndroidX — The Android Open Source Project\nOkHttp / Okio — Square, Inc.\nKotlin — JetBrains\nApache License 2.0\n\n'+apache,
  dependencies,drawings,fonts,diagrams,
].join('\n\n────────────────────────\n\n')}</pre>;}
