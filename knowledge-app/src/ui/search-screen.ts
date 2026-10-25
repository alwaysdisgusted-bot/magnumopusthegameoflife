import type { GrimoireFolder, GrimoireTab } from '../grimoire/models'
import { DOCUMENT_ACCEPT_VALUE, isSupportedDocument } from '../grimoire/documents'
import { searchDestinations } from '../search/destination-search'
import { isSearchQueryReady, searchLibrary, searchSources, type LibrarySearch, type LibrarySourceResult, type MapSearchNode } from '../search/search-service'
import type { GrimoireStore } from '../storage/grimoire-store'
import { folderSubtreeIds } from '../storage/grimoire-store'
import type { TextDocumentStore } from '../storage/source-store'
import type { SearchOccurrence } from '../sources/models'
import { icon } from './icons'
import { canExtractDocumentText, extractDocumentText } from '../grimoire/document-text-extractor'
import { InMemoryReadingPositionStore, type ReadingPositionStore } from '../storage/reading-position-store'
import { InMemoryReadingMarkerStore, type ReadingMarker, type ReadingMarkerStore } from '../storage/reading-marker-store'
import { markerFromSelection, renderReadingMarker } from './reading-marker'
import { InMemoryWordCollectionStore, type WordCollection, type WordCollectionStore } from '../storage/word-collection-store'
import { InMemoryEditedTextStore, type EditedTextStore, validateEditedText } from '../storage/edited-text-store'
import { RichEditor, renderRichDocument } from '../editor/rich-editor'
import { Workbench } from '../editor/workbench'
import { mountScreenPager } from './screen-pager'
import { encodeDocument, plainDocument } from '../editor/document'
import type { Editor } from '@tiptap/core'

const logoPath = `${import.meta.env.BASE_URL}magnum-opus-logo.png`

export interface SearchScreenOptions {
  accountEmail?: string
  onSignOut?: () => Promise<void>
  temporary?: boolean
  readingPositionStore?: ReadingPositionStore
  readingMarkerStore?: ReadingMarkerStore
  wordCollectionStore?: WordCollectionStore
  editedTextStore?: EditedTextStore
  onReady?: (controls: SearchScreenControls) => void
  mapNodes?: () => readonly MapSearchNode[]
  sourceErrors?: () => readonly string[]
  onQueryChange?: (query: string) => void
  onMapNode?: (node: MapSearchNode) => void
  externalSources?: (query: string) => readonly LibrarySourceResult[]
  readingReward?: {
    status(): Promise<{ turns: number; towardsReward: number }>
    turn(event: { eventId: string; documentId: string; fromPage: number; toPage: number }): Promise<{ turns: number; towardsReward: number; awarded: boolean }>
  }
}

export interface SearchScreenControls {
  refresh(): void
  openDocument(documentId: string, query?: string): Promise<void>
  search(query: string): LibrarySearch
  cancelPendingOpen(): void
}

export function mountSearchScreen(
  root: HTMLElement,
  sourceStore: TextDocumentStore,
  grimoireStore: GrimoireStore,
  options: SearchScreenOptions = {},
): () => void {
  root.innerHTML = `
    <a class="skip-link" href="#main-workspace">Preskočiť na obsah</a>
    <nav class="grimoire-section-nav" aria-label="Zamerať časť Grimoára">
      <button class="icon-button is-active" type="button" data-grimoire-view="reading" aria-controls="main-workspace" aria-pressed="true" aria-label="Čítačka" title="Zamerať Čítačku">${icon('book')}<span>Čítačka</span></button>
      <button class="icon-button" type="button" data-grimoire-view="workbench" aria-controls="grimoire-workbench" aria-pressed="false" aria-label="Pracovňa" title="Zamerať Pracovňu">${icon('folder')}<span>Pracovňa</span></button>
    </nav>
    <div class="app-shell">
      <header class="topbar masthead">
        <div class="wordmark"><img class="grimoire-brand" src="${logoPath}" alt="" /><h1 class="grimoire-title">Osobný grimoár</h1></div>
        <div class="account-controls">
          <span class="workspace-badge"><span class="status-tag"><span aria-hidden="true"></span><span id="account-label">Osobný Grimoár</span></span></span>
          <button class="text-button sign-out-button" id="sign-out" type="button" hidden>Odhlásiť</button>
        </div>
      </header>
      <div class="workspace-bar">
        <form class="search-form" role="search">
          <label class="visually-hidden" for="search-query">Hľadať v grimoári</label>
          ${icon('search')}
          <input id="search-query" name="query" type="search" maxlength="150" placeholder="Hľadať od 3 písmen…" autocomplete="off" />
          <button type="submit" aria-label="Vyhľadať" title="Vyhľadať">↵</button>
        </form>
      </div>
      <section id="search-results" class="results reader-section" aria-label="Výsledky vyhľadávania" aria-live="polite" hidden>
        <div class="results-heading">
          <h2>Výsledky</h2>
          <span class="result-count" id="result-count">0</span>
        </div>
        <div id="result-list"></div>
      </section>
      <main id="main-workspace" class="workspace book-workspace">
      <aside class="library-sidebar outline" aria-label="Osobný Grimoár">
        <div class="sidebar-heading">
          <div>
            <p class="eyebrow">Osobný priestor</p>
            <h2 class="sidebar-title">Obsah grimoára</h2>
          </div>
        </div>
        <p class="outline-caption">Všetko na svojom mieste</p>
        <div class="bookmark-heading">
          <p class="sidebar-label">ZÁLOŽKY</p>
          <button class="icon-button" id="add-tab" type="button" aria-label="Vytvoriť záložku" title="Vytvoriť záložku">+</button>
        </div>
        <nav id="tab-list" class="bookmark-list" aria-label="Záložky Grimoára"></nav>
        <form class="creation-form" id="tab-form" hidden>
          <label for="tab-title">Nová záložka</label>
          <div class="creation-controls">
            <input id="tab-title" name="title" maxlength="80" placeholder="Názov záložky" required />
            <button type="submit" aria-label="Uložiť záložku">Pridať</button>
          </div>
        </form>
        <div class="folder-section">
          <div class="folder-heading">
            <p class="sidebar-label">PRIEČINKY</p>
            <button class="text-button" id="add-folder" type="button" hidden>+ Nový</button>
          </div>
          <form class="creation-form" id="folder-form" hidden>
            <label id="folder-form-label" for="folder-title">Nový priečinok</label>
            <div class="creation-controls">
              <input id="folder-title" name="title" maxlength="80" placeholder="Názov priečinka" required />
              <button type="submit" aria-label="Uložiť priečinok">Pridať</button>
            </div>
          </form>
          <nav id="folder-list" class="folder-list" aria-label="Priečinky"></nav>
        </div>
        <div class="outline-note"><span aria-hidden="true">✧</span><p>Medzi myšlienkami<br />sa rodia súvislosti.</p><small>PRIESTOR PRE TVOJE POZNANIE</small></div>
      </aside>
      <section class="main-content reading-pane">
        <div class="page-toolbar">
          <div class="breadcrumbs">${icon('book')}<span>Grimoár</span>${icon('chevron')}<span id="breadcrumb-current">Prehľad</span></div>
          <div class="page-actions">
            <button class="icon-button" id="focus-toggle" type="button" aria-label="Režim sústredenia" aria-pressed="false" title="Režim sústredenia">${icon('focus')}</button>
            <button class="icon-button" id="outline-toggle" type="button" aria-label="Skryť alebo zobraziť obsah" aria-expanded="true" title="Obsah grimoára">${icon('panel')}</button>
          </div>
        </div>
        <div class="page-content" id="page-content">
          <div id="library-content">
          <section class="search-panel content-heading" aria-labelledby="page-title">
            <p class="eyebrow">OTVORENÁ KAPITOLA / TVOJE POZNANIE</p>
            <h2 id="page-title">Priestor pre tvoje poznanie.</h2>
            <p class="intro content-intro">Otvorte priečinok, čítajte svoje texty a nájdite v nich nové súvislosti.</p>
            <div class="chapter-divider" aria-hidden="true"><span></span>✦<span></span></div>
            <p id="index-status" class="availability-note" role="status"></p>
            <details class="index-tools">
              <summary>Textový index a vyhľadávanie</summary>
              <p class="availability-note search-hint">Presné textové vyhľadávanie bez rozlíšenia diakritiky a veľkosti písmen.</p>
              <button id="index-documents" class="text-button" type="button">Pripraviť uložené dokumenty na vyhľadávanie</button>
            </details>
          </section>
          <div class="welcome-art" id="welcome-art" role="region" aria-labelledby="welcome-title">
            <header class="welcome-heading">
              <span class="welcome-ornament" aria-hidden="true">✧</span>
              <h3 id="welcome-title">Sprievodca knižnicou</h3>
              <p>Tu nájdete prehľad funkcií knižnice. Otvorený dokument nahradí tento prehľad; po jeho zavretí sa sprievodca vráti.</p>
            </header>
            <ol class="welcome-steps">
              <li>
                <h4>Knihy a fotografie</h4>
                <p>V podmenu Knižnice zvoľte „Knihy a fotografie“. Pridávajte knihy, importujte zoznam z Goodreads, zapisujte prečítané strany a poznámky. Fotografie si usporiadajte do kategórií.</p>
              </li>
              <li>
                <h4>Záložky, priečinky a dokumenty</h4>
                <p>V „Obsahu grimoára“ vpravo vytvorte záložku, priečinky a podpriečinky. Kliknutím na záložku rozbalíte priečinky priamo pod ňou; kliknutím na priečinok zobrazíte jeho dokumenty a podpriečinky. Názov dokumentu otvorí čítačku Grimoára. Opätovné kliknutie vetvu zbalí; funguje aj Enter, medzerník a dotyk. V otvorenom priečinku pridajte dokumenty; názov a poznámku upravíte cez „Upraviť názov a poznámku“.</p>
              </li>
              <li>
                <h4>Vyhľadávanie od troch písmen</h4>
                <p>Horné pole hľadá zadaný text aj uprostred slova, bez rozlíšenia diakritiky a veľkosti písmen. Výsledky pod poľom obsahujú dokumenty, priečinky aj termíny. Klik na dokument otvorí zvýraznenú zhodu; priečinok alebo termín otvorí svoje miesto. Enter spustí hľadanie, šípka dolu prejde do výsledkov a Escape ich zavrie. Po odchode kurzora sa skryjú, návrat na pole ich obnoví.</p>
              </li>
              <li>
                <h4>Čítajte vlastným tempom</h4>
                <p>Dokument sa číta vľavo; ovládanie je vpravo. Zvoľte „Posúvať“ alebo „Strany“. Pri ďalšom otvorení sa obnoví uložené miesto. Za 25 potvrdených otočení strán získate 1 korunu; pri posúvaní sa počíta prejdenie celej výšky čítačky. Otvorenie výsledku vyhľadávania odmenu nepridáva.</p>
              </li>
              <li>
                <h4>Označte si dôležité slovo</h4>
                <p>Dvojklik na slovo v origináli nastaví značku miesta, kde ste prestali čítať. Každý dokument má vlastnú značku; odstránite ju cez „Zrušiť značku“. Originál si môžete stiahnuť. „Zavrieť“ vráti tento prehľad.</p>
              </li>
              <li>
                <h4>Dve stránky a sústredené čítanie</h4>
                <p>Ľavé tlačidlá „↑ Čítačka“ a „↓ Editor“ prepínajú dve plochy bez straty rozpracovaného obsahu. Hore pri vyhľadávaní môžete zapnúť režim sústredenia alebo skryť Obsah grimoára. Posúva sa iba obsah jednotlivých panelov.</p>
              </li>
              <li>
                <h4>Textový editor a vlastný koncept</h4>
                <p>„Upraviť v Pracovni“ otvorí dokument na dolnej stránke. Text môžete formátovať, hľadať a nahrádzať; zmeny potvrďte cez „Uložiť upravený text“. Uloženú verziu čítajte cez „Upravený text“. „Nový text“ je samostatný prázdny koncept, medzi ním a dokumentom prepínate tlačidlami. Koncept zostáva v otvorenej hre; môžete ho stiahnuť ako JSON. Originál dokumentu sa nemení.</p>
              </li>
              <li>
                <h4>Kanvas a alchymistický stôl</h4>
                <p>Na spoločnej ploche vľavo píšte a vpravo kreslite, pridávajte farebné lístky a fotografie. „Zamknúť text“ dovolí kresliť na pozadie aj za textom bez jeho zmeny. „Odomknúť text“ vráti písanie a ľavú polovicu opäť chráni pred kreslením. Prepínač „Kresba a lístok do textu“ umožní vložiť výtvor na miesto kurzora v dokumente. Spoločný kanvas používa pôvodné ukladanie stola. Rozmery nastavíte hore; editor aj kanvas môžete otvoriť v samostatnom okne.</p>
              </li>
              <li>
                <h4>Mapa stromu a vlastné pojmy</h4>
                <p>V podmenu Knižnice otvorte „Mapu stromu“. Prechádzajte odbory, pridávajte vlastné termíny, definície a podbubliny. Pripojené dokumenty sa prepájajú s priečinkami Grimoára; výsledok hľadania vás vráti na zvýraznený text. Mapu môžete posúvať, približovať a prehľadávať.</p>
              </li>
              <li>
                <h4>Definície, zlaté uzly a otázky</h4>
                <p>Za vlastnú definíciu s tromi odlišnými nahranými zdrojmi dostanete jednorazovo 30 korún. Vyplnenie všetkých termínov uzla pridá 300 korún a trvalú zlatú farbu. Počítadlá pri strome ukazujú definície aj zlaté uzly. Približne každých 10 minút používania hry sa objaví vaša definícia; správny pojem odmení 3 korunami.</p>
              </li>
            </ol>
            <div class="welcome-notes">
              <p><strong>Formáty a index.</strong> Grimoár prijíma PDF s textovou vrstvou, Word, PowerPoint, Excel, ODT/ODS/ODP, RTF, HTML, CSV/TSV, JSON, XML, LOG, TXT a Markdown. Čítačka zobrazuje získaný text, nie pôvodnú grafickú úpravu. Ostatné súbory zostávajú dostupné ako originály. Ak text ešte nie je pripravený, v Obsahu otvorte „Textový index a vyhľadávanie“.</p>
              <p><strong>Ukladanie a zálohy.</strong> V lokálnej hre sa uložené dáta účtu nachádzajú v tomto počítači. Upravený text dokumentu uložte jeho vlastným tlačidlom; neuložené koncepty sú iba v otvorenej hre. Originály pridané cez Mapu stromu zálohujte aj jej exportom. Sprievodcu môžete pri otvorenom dokumente kedykoľvek zobraziť tlačidlom „Sprievodca“.</p>
            </div>
          </div>
          <section class="current-location reader-section" aria-live="polite">
          <div class="location-heading">
            <div>
              <p class="eyebrow">Aktuálne miesto</p>
              <h2 id="location-title">Začnite vytvorením záložky</h2>
            </div>
            <span id="location-kind" class="location-kind"></span>
          </div>
          <p id="operation-message" class="operation-message" role="status" aria-live="polite"></p>
          <p id="location-description" class="empty-state">Vytvorte záložku a potom v nej priečinok, kam budete ukladať obsah Grimoára.</p>
          <div id="folder-contents" class="folder-contents"></div>
          <section id="document-section" class="document-section" hidden aria-labelledby="documents-title">
            <div class="documents-heading">
              <div>
                <p class="eyebrow">Obsah priečinka</p>
                <h3 id="documents-title">Dokumenty</h3>
              </div>
              <label class="upload-button" for="document-upload">＋ Pridať dokumenty</label>
              <input id="document-upload" class="visually-hidden" type="file" multiple />
            </div>
            <p class="document-formats">PDF s textovou vrstvou, Word, PowerPoint, Excel, ODT/ODS/ODP, RTF, HTML, CSV/TSV, JSON, XML, LOG, TXT a Markdown.</p>
            <p id="upload-message" class="upload-message" role="status" aria-live="polite"></p>
            <ul id="document-list" class="document-list" hidden></ul>
          </section>
          </section>
          </div>
          <section id="reader" class="reader" hidden aria-labelledby="reader-title">
            <div class="reader-heading">
              <div>
                <p class="eyebrow">Pôvodný text · iba na čítanie</p>
                <h3 id="reader-title"></h3>
              </div>
              <div class="reader-actions">
                <span class="reader-marker-control">
                  <button class="text-button" id="reader-clear-marker" type="button" aria-describedby="reader-marker-tooltip">Zrušiť značku</button>
                  <span id="reader-marker-tooltip" class="reader-marker-tooltip" role="tooltip" hidden>Odstráni označenie slova, kde ste prestali čítať, iba v tomto dokumente. Novú značku vytvoríte dvojklikom na slovo.</span>
                </span>
                <div class="reader-layout" role="group" aria-label="Spôsob čítania">
                  <button class="reader-mode-button" id="reader-scroll" type="button" aria-pressed="true">Posúvať</button>
                  <button class="reader-mode-button" id="reader-paged" type="button" aria-pressed="false">Strany</button>
                </div>
                <button class="text-button reader-close" id="reader-close" type="button">Zavrieť</button>
              </div>
            </div>
            <div class="reader-version-controls" role="group" aria-label="Verzia textu na čítanie">
              <span class="reader-version-label">Čítať</span>
              <button class="reader-mode-button is-active" id="reader-original-version" type="button" aria-pressed="true">Originál</button>
              <button class="reader-mode-button" id="reader-edited-version" type="button" aria-pressed="false" disabled>Upravený text</button>
            </div>
            <p id="reader-version-note" class="reader-version-note">Originál je iba na čítanie. Vyhľadávanie a značka čítania sa vzťahujú na pôvodný text.</p>
            <div id="reader-content" class="reader-content" tabindex="0"></div>
            <div class="reader-mode reader-pagination" id="reader-pagination" role="group" aria-label="Otáčanie strán" hidden>
              <button class="reader-mode-button" id="reader-previous" type="button" aria-label="Predchádzajúca strana">←</button>
              <span id="reader-position" aria-live="polite"></span>
              <button class="reader-mode-button" id="reader-next" type="button" aria-label="Ďalšia strana">→</button>
            </div>
            <p id="reader-status" class="operation-message" role="status"></p>
            <p id="reader-marker-status" class="operation-message" role="status"></p>
            <div id="reader-reward-progress" class="reader-reward-progress" hidden>
              <div class="reader-reward-heading">
                <label for="reader-reward-bar">XP čítania</label>
                <span id="reader-reward-count"></span>
              </div>
              <progress id="reader-reward-bar" max="25" aria-describedby="reader-reward-total"></progress>
              <p id="reader-reward-total"></p>
            </div>
            <p id="reader-reward-status" class="operation-message" role="status"></p>
            <button id="reader-reward-retry" class="text-button" type="button" hidden>Zopakovať potvrdenie otočenia</button>
            <section class="reader-editor" aria-labelledby="reader-editor-title">
              <div class="reader-editor-heading">
                <div>
                  <p class="eyebrow">Nástroj</p>
                  <h4 id="reader-editor-title">Pracovňa</h4>
                </div>
                <button class="text-button" id="reader-editor-toggle" type="button" aria-expanded="false">Upraviť v Pracovni</button>
              </div>
              <div id="reader-editor-panel" class="reader-editor-panel" hidden>
                <textarea id="reader-editor-text" hidden disabled aria-hidden="true"></textarea>
                <div id="reader-rich-editor"></div>
                <div class="reader-editor-actions">
                  <button class="text-button" id="reader-editor-save" type="button" disabled>Uložiť upravený text</button>
                  <span id="reader-editor-status" class="operation-message" role="status" aria-live="polite"></span>
                </div>
              </div>
            </section>
          </section>
        </div>
        <footer class="page-footer"><span>MAGNUM OPUS <span aria-hidden="true">·</span> TVOJA CESTA POZNANÍM</span><span id="page-position">01</span></footer>
      </section>
      </main>
    <footer class="footer app-footer">
      <span>Vaše poznanie. Vaše zdroje.</span>
      <span>Osobný Grimoár</span>
    </footer>
    </div>
  `

  const form = root.querySelector<HTMLFormElement>('.search-form')
  const input = root.querySelector<HTMLInputElement>('#search-query')
  const resultList = root.querySelector<HTMLElement>('#result-list')
  const resultCount = root.querySelector<HTMLElement>('#result-count')
  const resultsPanel = root.querySelector<HTMLElement>('#search-results')
  const tabForm = root.querySelector<HTMLFormElement>('#tab-form')
  const tabTitle = root.querySelector<HTMLInputElement>('#tab-title')
  const folderForm = root.querySelector<HTMLFormElement>('#folder-form')
  const folderTitle = root.querySelector<HTMLInputElement>('#folder-title')
  const tabList = root.querySelector<HTMLElement>('#tab-list')
  const folderList = root.querySelector<HTMLElement>('#folder-list')
  const addTabButton = root.querySelector<HTMLButtonElement>('#add-tab')
  const addFolderButton = root.querySelector<HTMLButtonElement>('#add-folder')
  const folderFormLabel = root.querySelector<HTMLElement>('#folder-form-label')
  const locationTitle = root.querySelector<HTMLElement>('#location-title')
  const locationKind = root.querySelector<HTMLElement>('#location-kind')
  const locationDescription = root.querySelector<HTMLElement>('#location-description')
  const folderContents = root.querySelector<HTMLElement>('#folder-contents')
  const welcomeArt = root.querySelector<HTMLElement>('#welcome-art')
  const documentSection = root.querySelector<HTMLElement>('#document-section')
  const documentInput = root.querySelector<HTMLInputElement>('#document-upload')
  const documentList = root.querySelector<HTMLUListElement>('#document-list')
  const uploadMessage = root.querySelector<HTMLElement>('#upload-message')
  const libraryContent = root.querySelector<HTMLElement>('#library-content')
  const reader = root.querySelector<HTMLElement>('#reader')
  const readerTitle = root.querySelector<HTMLElement>('#reader-title')
  const readerContent = root.querySelector<HTMLElement>('#reader-content')
  const readerClose = root.querySelector<HTMLButtonElement>('#reader-close')
  const readerPrevious = root.querySelector<HTMLButtonElement>('#reader-previous')
  const readerNext = root.querySelector<HTMLButtonElement>('#reader-next')
  const readerPosition = root.querySelector<HTMLElement>('#reader-position')
  const readerStatus = root.querySelector<HTMLElement>('#reader-status')
  const readerPagination = root.querySelector<HTMLElement>('#reader-pagination')
  const readerScroll = root.querySelector<HTMLButtonElement>('#reader-scroll')
  const readerPaged = root.querySelector<HTMLButtonElement>('#reader-paged')
  const readerClearMarker = root.querySelector<HTMLButtonElement>('#reader-clear-marker')
  const readerMarkerTooltip = root.querySelector<HTMLElement>('#reader-marker-tooltip')
  const readerMarkerStatus = root.querySelector<HTMLElement>('#reader-marker-status')
  const readerOriginalVersion = root.querySelector<HTMLButtonElement>('#reader-original-version')
  const readerEditedVersion = root.querySelector<HTMLButtonElement>('#reader-edited-version')
  const readerVersionNote = root.querySelector<HTMLElement>('#reader-version-note')
  const readerEditorToggle = root.querySelector<HTMLButtonElement>('#reader-editor-toggle')
  const readerEditorPanel = root.querySelector<HTMLElement>('#reader-editor-panel')
  const readerEditorText = root.querySelector<HTMLTextAreaElement>('#reader-editor-text')
  const readerEditorSave = root.querySelector<HTMLButtonElement>('#reader-editor-save')
  const readerEditorStatus = root.querySelector<HTMLElement>('#reader-editor-status')
  const accountLabel = root.querySelector<HTMLElement>('#account-label')
  const signOutButton = root.querySelector<HTMLButtonElement>('#sign-out')
  const operationMessage = root.querySelector<HTMLElement>('#operation-message')
  const breadcrumbCurrent = root.querySelector<HTMLElement>('#breadcrumb-current')
  const focusToggle = root.querySelector<HTMLButtonElement>('#focus-toggle')
  const outlineToggle = root.querySelector<HTMLButtonElement>('#outline-toggle')
  const pagePosition = root.querySelector<HTMLElement>('#page-position')
  const indexButton = root.querySelector<HTMLButtonElement>('#index-documents')
  const indexStatus = root.querySelector<HTMLElement>('#index-status')

  if (
    !form || !input || !resultList || !resultCount || !resultsPanel || !tabForm || !tabTitle ||
    !folderForm || !folderTitle || !tabList || !folderList ||
    !addTabButton || !addFolderButton || !folderFormLabel || !locationTitle ||
    !locationKind || !locationDescription || !folderContents || !welcomeArt || !documentSection ||
    !documentInput || !documentList || !uploadMessage || !libraryContent || !reader || !readerTitle ||
    !readerContent || !readerClose || !readerPrevious || !readerNext || !readerPosition || !readerStatus ||
    !readerPagination || !readerScroll || !readerPaged || !readerClearMarker || !readerMarkerTooltip || !readerMarkerStatus ||
    !readerOriginalVersion || !readerEditedVersion || !readerVersionNote || !readerEditorToggle ||
    !readerEditorPanel || !readerEditorText || !readerEditorSave || !readerEditorStatus ||
    !accountLabel || !signOutButton || !operationMessage || !breadcrumbCurrent ||
    !focusToggle || !outlineToggle || !pagePosition || !indexButton || !indexStatus ||
    !input
  ) {
    throw new Error('Nepodarilo sa pripraviť rozhranie Osobného Grimoára.')
  }

  const readerPanel = reader
  const libraryGuide = welcomeArt
  const readerHeading = readerTitle
  const readerText = readerContent
  const originalVersionButton = readerOriginalVersion
  const editedVersionButton = readerEditedVersion
  const versionNote = readerVersionNote
  const editorToggle = readerEditorToggle
  const editorPanel = readerEditorPanel
  const editorText = readerEditorText
  const editorSave = readerEditorSave
  const editorStatus = readerEditorStatus
  const clearMarkerButton = readerClearMarker
  const libraryPanel = libraryContent
  const folderContentPanel = folderContents
  const searchResults = resultsPanel
  const positions = options.readingPositionStore ?? new InMemoryReadingPositionStore()
  const markers = options.readingMarkerStore ?? new InMemoryReadingMarkerStore()
  const collections = options.wordCollectionStore ?? new InMemoryWordCollectionStore()
  const editedTexts = options.editedTextStore ?? new InMemoryEditedTextStore()
  const richEditors = new Map<string, RichEditor>()
  const editedSaves = new Set<string>()
  const workbench = new Workbench(editorPanel, () => {
    for (const rich of richEditors.values()) rich.updateRoot()
    resetScrollReadingTracking()
  }, locked => {
    for (const rich of richEditors.values()) rich.editor.setEditable(!locked)
  })
  const readingArea = root.querySelector<HTMLElement>('#main-workspace')!
  const layout = document.createElement('div')
  layout.className = 'grimoire-layout'
  const sections = document.createElement('div')
  sections.className = 'grimoire-sections'
  readingArea.before(layout)
  layout.append(sections)
  sections.append(readingArea, workbench.element)
  readingArea.tabIndex = -1
  workbench.element.tabIndex = -1
  const pageContent = root.querySelector<HTMLElement>('#page-content')!
  const librarySidebar = root.querySelector<HTMLElement>('.library-sidebar')!
  const contentHeading = libraryPanel.querySelector('.content-heading')!
  const indexTools = contentHeading.querySelector('.index-tools')!
  indexTools.append(indexStatus)
  const locationPanel = libraryPanel.querySelector('.current-location')!
  const folderTools = document.createElement('div')
  folderTools.className = 'folder-tools'
  folderTools.append(folderContents, documentSection)
  folderList.after(folderTools)
  librarySidebar.append(operationMessage, indexTools)
  locationPanel.remove()
  contentHeading.remove()
  libraryPanel.replaceChildren(librarySidebar)
  pageContent.prepend(readerPanel)
  const readerEmpty = document.createElement('section')
  readerEmpty.className = 'reader-empty'
  readerEmpty.setAttribute('aria-label', 'Sprievodca funkciami knižnice')
  readerEmpty.tabIndex = 0
  pageContent.prepend(readerEmpty)
  pageContent.prepend(root.querySelector('.grimoire-section-nav')!)
  root.querySelector('.page-toolbar')!.insertBefore(form, root.querySelector('.page-actions'))
  const guide = document.createElement('details')
  guide.className = 'grimoire-guide'
  const guideToggle = document.createElement('summary')
  guideToggle.textContent = 'Sprievodca'
  guide.append(guideToggle)
  root.querySelector('.page-toolbar')!.append(guide)
  const updateLibraryGuide = (): void => {
    const documentOpen = !readerPanel.hidden
    readerEmpty.hidden = documentOpen
    guide.hidden = !documentOpen
    guide.open = false
    const destination = documentOpen ? guide : readerEmpty
    destination.append(libraryGuide)
  }
  updateLibraryGuide()
  form.after(searchResults)
  searchResults.classList.add('search-result-popover')
  searchResults.setAttribute('popover', 'manual')
  input.setAttribute('aria-controls', 'search-results')
  input.setAttribute('aria-expanded', 'false')
  let searchPopupRequested = false
  let searchCloseTimer: ReturnType<typeof setTimeout> | undefined
  let resultsTimer: ReturnType<typeof setTimeout> | undefined
  const positionSearchPopup = (): void => {
    const bounds = form.getBoundingClientRect()
    const width = Math.min(Math.max(bounds.width, 300), window.innerWidth - 20)
    searchResults.style.width = `${width}px`
    searchResults.style.left = `${Math.max(10, Math.min(bounds.left, window.innerWidth - width - 10))}px`
    searchResults.style.top = `${bounds.bottom}px`
    searchResults.style.maxHeight = `${Math.max(0, window.innerHeight - bounds.bottom - 10)}px`
  }
  const updateSearchPopup = (): void => {
    const visible = searchPopupRequested && !!input.value.trim() && root.dataset.grimoireView !== 'workbench'
    searchResults.hidden = !input.value.trim()
    if (visible) {
      positionSearchPopup()
      if (!searchResults.matches(':popover-open')) searchResults.showPopover()
    } else if (searchResults.matches(':popover-open')) searchResults.hidePopover()
    input.setAttribute('aria-expanded', String(visible))
  }
  function showSearchPopup(): void {
    clearTimeout(searchCloseTimer)
    searchCloseTimer = undefined
    searchPopupRequested = true
    updateSearchPopup()
  }
  function hideSearchPopup(): void {
    clearTimeout(searchCloseTimer)
    searchCloseTimer = undefined
    searchPopupRequested = false
    updateSearchPopup()
  }
  function closeSearchLater(): void {
    if (searchCloseTimer !== undefined) return
    searchCloseTimer = setTimeout(hideSearchPopup, 180)
  }
  for (const surface of [form, searchResults]) {
    surface.addEventListener('pointerenter', showSearchPopup)
    surface.addEventListener('pointerleave', closeSearchLater)
    surface.addEventListener('focusin', showSearchPopup)
    surface.addEventListener('focusout', event => {
      const next = event.relatedTarget
      if (!(next instanceof Node) || (!form.contains(next) && !searchResults.contains(next))) closeSearchLater()
    })
    surface.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        hideSearchPopup()
        input.focus({ preventScroll: true })
        hideSearchPopup()
      }
    })
  }
  form.addEventListener('pointerdown', showSearchPopup)
  input.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown') return
    showSearchPopup()
    const first = resultList.querySelector<HTMLElement>('a, button')
    if (first) { event.preventDefault(); first.focus() }
  })
  searchResults.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('a, button')) hideSearchPopup()
  }, true)
  const trackSearchPointer = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || !searchPopupRequested) return
    const target = event.target
    if (target instanceof Node && (form.contains(target) || searchResults.contains(target))) {
      clearTimeout(searchCloseTimer)
      searchCloseTimer = undefined
    } else closeSearchLater()
  }
  document.addEventListener('pointermove', trackSearchPointer)
  root.addEventListener('pointerleave', closeSearchLater)
  window.addEventListener('resize', positionSearchPopup)
  root.querySelector('.workspace-bar')!.remove()
  const rightPanel = document.createElement('aside')
  rightPanel.className = 'grimoire-right-panel'
  rightPanel.setAttribute('aria-label', 'Ovládanie a zdroje Grimoára')
  const readerControls = document.createElement('div')
  readerControls.className = 'grimoire-reader-controls'
  for (const child of Array.from(readerPanel.children)) {
    if (child !== readerContent) readerControls.append(child)
  }
  readerControls.append(createButton('Stiahnuť originál', () => {
    if (readingDocumentId) void downloadOriginal(readingDocumentId, readerHeading.textContent ?? 'dokument')
  }, 'text-button reader-download'))
  rightPanel.append(libraryPanel, readerControls)
  pageContent.append(rightPanel)
  function setGrimoireView(view: 'reading' | 'workbench'): void {
    hideSearchPopup()
    root.dataset.grimoireView = view
    root.dispatchEvent(new Event('grimoire-view-change'))
    root.querySelectorAll<HTMLButtonElement>('[data-grimoire-view]').forEach(button => {
      const active = button.dataset.grimoireView === view
      button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active))
    })
    if (view === 'workbench') workbench.activate()
    const target = view === 'workbench' ? workbench.element : readingArea
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'start' })
    resetScrollReadingTracking()
  }
  root.querySelectorAll<HTMLButtonElement>('[data-grimoire-view]').forEach(button =>
    button.addEventListener('click', () => setGrimoireView(button.dataset.grimoireView === 'workbench' ? 'workbench' : 'reading')))
  root.dataset.grimoireView = 'reading'
  const returnPanels = () => workbench.restoreAll()
  window.addEventListener('pagehide', returnPanels)
  let richReader: Editor | undefined
  function mountRichEditor(documentId: string, value: string): void {
    let rich = richEditors.get(documentId)
    if (!rich) {
      rich = new RichEditor(value, next => {
        editedTextByDocument.set(documentId, next)
        if (readingDocumentId !== documentId) return
        editorText.value = next
        editorStatus.textContent = 'Neuložené zmeny zostávajú v pamäti tejto stránky.'
        updateEditorSaveState()
      })
      richEditors.set(documentId, rich)
    }
    root.querySelector('#reader-rich-editor')!.replaceChildren(rich.element)
    workbench.setDrawingPad(rich.pad, sourceStore.listSources().find(source => source.id === documentId)?.title ?? 'Text dokumentu', rich)
    editorText.value = rich.value
  }
  let activeCollectionId: string | null = null
  let collectionUploadBusy = false
  const markerFeedback = readerMarkerStatus
  const markerTooltip = readerMarkerTooltip
  let markerRevision = 0
  const positionFeedback = readerStatus
  const previousPage = readerPrevious
  const nextPage = readerNext
  const positionLabel = readerPosition
  const pagination = readerPagination
  const scrollModeButton = readerScroll
  const pagedModeButton = readerPaged
  let pagedReading = false
  let readingDocumentId: string | null = null
  let readingVersion: 'original' | 'edited' = 'original'
  let originalReadingText = ''
  let savedEditedText: string | undefined
  let editorBaseline = ''
  let editedTextLoaded = false
  let editedTextLoading = false
  let editedTextRevision = 0
  let editorOpen = false
  const editedTextByDocument = new Map<string, string>()
  const editedPositions = new Map<string, { pageIndex: number; scrollFraction: number }>()
  let currentPage = 0
  let readingPages: HTMLElement[] = []
  let savePositionTimer: number | undefined
  const searchInput = input
  const indexingStatus = indexStatus
  document.documentElement.dataset.theme = 'dark'
  root.dataset.theme = 'dark'
  const operationStatus = operationMessage
  accountLabel.textContent = options.accountEmail ?? (options.temporary ? 'Dočasné úložisko' : 'Osobný Grimoár')
  signOutButton.hidden = !options.onSignOut
  documentInput.accept = DOCUMENT_ACCEPT_VALUE
  let activeTabId: string | null = null
  let activeFolderId: string | null = null
  let expandedTabId: string | null = null
  const expandedFolderIds = new Set<string>()
  const folderSection = folderList.closest<HTMLElement>('.folder-section')!
  let readerRequest = 0
  const pendingExtractions = new Map<string, Promise<void>>()

  root.querySelector<HTMLAnchorElement>('.brand-mark')?.addEventListener('click', (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    activeCollectionId = null
    activeFolderId = null
    searchInput.value = ''
    renderLibrary()
    renderResults()
    root.querySelector<HTMLButtonElement>('[data-workspace-action="grimoire"]')?.click()
  })

  focusToggle.addEventListener('click', () => {
    const active = focusToggle.getAttribute('aria-pressed') !== 'true'
    root.querySelector('.app-shell')?.classList.toggle('focus-mode', active)
    focusToggle.setAttribute('aria-pressed', String(active))
  })
  outlineToggle.addEventListener('click', () => {
    const expanded = outlineToggle.getAttribute('aria-expanded') !== 'false'
    root.querySelector('.app-shell')?.classList.toggle('outline-hidden', expanded)
    outlineToggle.setAttribute('aria-expanded', String(!expanded))
    outlineToggle.setAttribute('aria-label', expanded ? 'Zobraziť obsah' : 'Skryť obsah')
  })

  const getActiveTab = (): GrimoireTab | undefined =>
    grimoireStore.listTabs().find((tab) => tab.id === activeTabId)

  const getActiveFolder = (): GrimoireFolder | undefined =>
    activeTabId
      ? grimoireStore.listFolders(activeTabId).find((folder) => folder.id === activeFolderId)
      : undefined

  const findDocumentLocation = (sourceId: string) => {
    for (const tab of grimoireStore.listTabs()) {
      const folders = grimoireStore.listFolders(tab.id)
      for (const folder of folders) {
        const stored = grimoireStore.listDocuments(folder.id).find((item) => item.id === sourceId)
        if (!stored) continue
        const path = [folder.title]
        const visited = new Set([folder.id])
        let parentId = folder.parentId
        while (parentId && !visited.has(parentId)) {
          visited.add(parentId)
          const parent = folders.find((item) => item.id === parentId)
          if (!parent) break
          path.unshift(parent.title)
          parentId = parent.parentId
        }
        return { tabId: tab.id, folderId: folder.id, path: [tab.title, ...path, stored.name].join(' → ') }
      }
    }
    return undefined
  }

  const renderLocation = (): void => {
    const collection = collections.list().find((item) => item.id === activeCollectionId)
    if (collection) {
      locationTitle.textContent = collection.title
      breadcrumbCurrent.textContent = collection.title
      locationKind.textContent = collection.kind === 'tab' ? 'SLOVNÁ ZÁLOŽKA' : 'SLOVNÝ PRIEČINOK'
      locationDescription.textContent = `Živá kolekcia pre slovo „${collection.word}“. Úprava názvu nemení hľadané slovo; odstránenie odkazu nemení originál.`
      welcomeArt.hidden = false
      addFolderButton.hidden = true
      folderForm.hidden = true
      documentSection.hidden = true
      folderContents.replaceChildren()
      folderContents.append(createFolderEditor(collection.title, collection.note, 120,
        (title, note) => collections.saveDetails(collection.id, title, note),
        () => activeCollectionId === collection.id))
      const uploadLabel = document.createElement('label')
      uploadLabel.className = 'collection-upload'
      uploadLabel.textContent = 'Nahrať dokumenty'
      const upload = document.createElement('input')
      upload.type = 'file'
      upload.className = 'collection-upload-input'
      upload.multiple = true
      upload.accept = DOCUMENT_ACCEPT_VALUE
      upload.disabled = collectionUploadBusy
      uploadLabel.append(upload)
      const uploadHint = document.createElement('p')
      uploadHint.className = 'document-formats'
      uploadHint.textContent = 'Súbory sa pridajú aj bez hľadaného slova. Originály sa uložia do automaticky vytvoreného bežného priečinka (najviac 50 MB na súbor).'
      upload.addEventListener('change', () => { void uploadCollectionDocuments(collection.id, upload) })
      folderContents.append(uploadLabel, uploadHint)
      const results = collectionResults(collection)
      const count = document.createElement('p')
      count.className = 'document-formats'
      count.textContent = `Dokumenty v kolekcii: ${results.length}. Obsahuje presné textové zhody aj ručne pridané dokumenty.`
      folderContents.append(count)
      if (!results.length) folderContents.append(createEmptyState('V tejto kolekcii zatiaľ nie sú dokumenty.'))
      for (const result of results) {
        const row = document.createElement('div')
        row.className = 'word-collection-document'
        row.append(createButton(findDocumentLocation(result.sourceId)?.path ?? result.sourceTitle,
          () => openCollectionDocument(collection, result), 'favorite-document'))
        const remove = createButton('Odstrániť z kolekcie', () => {
          remove.disabled = true
          void collections.exclude(collection.id, result.sourceId).then(() => {
            if (activeCollectionId === collection.id && readerPanel.hidden) renderLibrary()
            operationStatus.textContent = 'Odkaz odstránený z kolekcie. Pôvodný dokument zostal zachovaný.'
          }, (error: unknown) => {
            operationStatus.textContent = `Odkaz sa nepodarilo odstrániť: ${errorMessage(error)}`
            remove.disabled = false
          })
        }, 'text-button collection-remove')
        row.append(remove)
        folderContents.append(row)
      }
      return
    }
    const tab = getActiveTab()
    const folder = getActiveFolder()

    locationTitle.textContent = folder?.title ?? tab?.title ?? 'Začnite vytvorením záložky'
    breadcrumbCurrent.textContent = folder?.title ?? tab?.title ?? 'Prehľad'
    pagePosition.textContent = tab ? String(grimoireStore.listTabs().findIndex((item) => item.id === tab.id) + 1).padStart(2, '0') : '01'
    locationKind.textContent = folder ? 'PRIEČINOK' : tab ? 'ZÁLOŽKA' : ''
    locationDescription.textContent = folder
      ? 'Tento priečinok je pripravený na obsah Grimoára. Podpriečinky môžete vytvárať tlačidlom „Nový priečinok“.'
      : tab
        ? 'Záložka vytvorená. Vytvorte v nej prvý priečinok na usporiadanie obsahu.'
        : 'Vytvorte záložku a potom v nej priečinok, kam budete ukladať obsah Grimoára.'
    welcomeArt.hidden = false
    addFolderButton.hidden = !tab
    folderFormLabel.textContent = folder ? 'Nový podpriečinok' : 'Nový priečinok'
    folderTitle.placeholder = folder ? 'Názov podpriečinka' : 'Názov priečinka'
    documentSection.hidden = !folder
    uploadMessage.textContent = ''

    folderContents.replaceChildren()
    if (folder) {
      folderContents.append(createFolderEditor(folder.title, folder.note, 80,
        async (title, note) => { await grimoireStore.saveFolderDetails(folder.id, title, note) },
        () => !activeCollectionId && activeFolderId === folder.id))
    }
  }

  const renderLibrary = (): void => {
    closeReader()
    const tabs = grimoireStore.listTabs()
    if (!tabs.some((tab) => tab.id === activeTabId)) {
      activeTabId = tabs[0]?.id ?? null
      activeFolderId = null
    }
    if (activeFolderId && !grimoireStore.listFolders(activeTabId ?? '').some((folder) => folder.id === activeFolderId)) {
      activeFolderId = null
    }

    if (activeFolderId) {
      expandedTabId = activeTabId
      const folders = grimoireStore.listFolders(activeTabId ?? '')
      let parent = folders.find(folder => folder.id === activeFolderId)?.parentId
      while (parent) {
        expandedFolderIds.add(parent)
        parent = folders.find(folder => folder.id === parent)?.parentId
      }
    }
    folderSection.remove()
    tabList.replaceChildren()
    for (const tab of tabs) {
      const iconNode = document.createElement('span')
      iconNode.className = 'bookmark-icon'
      iconNode.setAttribute('aria-hidden', 'true')
      iconNode.innerHTML = icon('book')
      const title = document.createElement('span')
      title.textContent = tab.title
      const button = createButton(tab.title, () => {
        expandedTabId = expandedTabId === tab.id ? null : tab.id
        activeCollectionId = null
        activeTabId = tab.id
        activeFolderId = null
        renderLibrary()
        root.querySelector<HTMLButtonElement>(`[data-tab-id="${CSS.escape(tab.id)}"]`)?.focus()
      }, `tree-row user-bookmark${tab.id === activeTabId && !activeCollectionId ? ' is-active' : ''}`)
      button.replaceChildren(iconNode, title)
      button.setAttribute('aria-current', tab.id === activeTabId && !activeCollectionId ? 'page' : 'false')
      button.dataset.tabId = tab.id
      button.setAttribute('aria-expanded', String(tab.id === expandedTabId))
      if (tab.id === expandedTabId) button.setAttribute('aria-controls', 'grimoire-folder-section')
      const entry = document.createElement('div')
      entry.className = 'tree-entry'
      const edit = createButton('⋯', () => openOrganizer('tab', tab.id), 'tree-edit-button')
      edit.setAttribute('aria-label', `Upraviť záložku ${tab.title}`)
      entry.append(button, edit)
      const branch = document.createElement('div')
      branch.className = 'bookmark-branch'
      branch.append(entry)
      if (tab.id === expandedTabId) branch.append(folderSection)
      tabList.append(branch)
    }
    const availableCollections = collections.list().filter((item) => !item.parentTabId || tabs.some((tab) => tab.id === item.parentTabId))
    if (activeCollectionId && !availableCollections.some((item) => item.id === activeCollectionId)) activeCollectionId = null
    for (const collection of availableCollections.filter((item) => item.kind === 'tab')) {
      const button = createButton(collection.title, () => openCollection(collection),
        `tree-row user-bookmark word-collection${collection.id === activeCollectionId ? ' is-active' : ''}`)
      const iconNode = document.createElement('span')
      iconNode.className = 'bookmark-icon'
      iconNode.setAttribute('aria-hidden', 'true')
      iconNode.innerHTML = icon('book')
      const title = document.createElement('span')
      title.textContent = collection.title
      button.replaceChildren(iconNode, title)
      button.setAttribute('aria-current', collection.id === activeCollectionId ? 'page' : 'false')
      const entry = document.createElement('div')
      entry.className = 'tree-entry'
      const edit = createButton('⋯', () => editCollection(collection), 'tree-edit-button')
      edit.setAttribute('aria-label', `Upraviť záložku ${collection.title}`)
      entry.append(button, edit)
      tabList.append(entry)
    }
    if (tabs.length === 0 && !availableCollections.some((item) => item.kind === 'tab')) {
      const empty = document.createElement('span')
      empty.className = 'tab-empty-state'
      empty.textContent = 'Zatiaľ nemáte záložku'
      tabList.append(empty)
    }

    folderList.replaceChildren()
    const selectedCollection = availableCollections.find((item) => item.id === activeCollectionId)
    folderSection.id = 'grimoire-folder-section'
    folderSection.hidden = !expandedTabId && selectedCollection?.kind !== 'tab'
    if (!folderSection.isConnected) tabList.append(folderSection)
    if (selectedCollection?.kind === 'tab') {
      appendCollectionDocuments(selectedCollection, folderList)
    } else if (activeTabId) {
      renderFolderTree(grimoireStore.listFolders(activeTabId), null, 0, folderList)
      for (const collection of availableCollections.filter((item) => item.parentTabId === activeTabId)) {
        const button = createButton(collection.title, () => openCollection(collection),
          `folder-tree-button word-collection${collection.id === activeCollectionId ? ' is-active' : ''}`)
        button.style.setProperty('--folder-depth', '0')
        button.setAttribute('aria-current', collection.id === activeCollectionId ? 'page' : 'false')
        const entry = document.createElement('div')
        entry.className = 'tree-entry'
        const edit = createButton('⋯', () => editCollection(collection), 'tree-edit-button')
        edit.setAttribute('aria-label', `Upraviť priečinok ${collection.title}`)
        entry.append(button, edit)
        folderList.append(entry)
        appendCollectionDocuments(collection, folderList)
      }
    } else {
      folderList.append(createEmptyState('Priečinky sa zobrazia po vytvorení záložky.'))
    }
    renderLocation()
  }

  const renderFolderTree = (
    folders: readonly GrimoireFolder[],
    parentId: string | null,
    depth: number,
    container: HTMLElement,
  ): void => {
    for (const folder of folders.filter((candidate) => candidate.parentId === parentId)) {
      const button = createButton(folder.title, () => {
        if (expandedFolderIds.has(folder.id)) expandedFolderIds.delete(folder.id)
        else expandedFolderIds.add(folder.id)
        activeCollectionId = null
        activeFolderId = folder.id
        renderLibrary()
        root.querySelector<HTMLButtonElement>(`[data-folder-documents="${CSS.escape(folder.id)}"] > .folder-tree-button`)?.focus()
      }, `folder-tree-button${folder.id === activeFolderId && !activeCollectionId ? ' is-active' : ''}`)
      button.style.setProperty('--folder-depth', String(depth))
      button.setAttribute('aria-current', folder.id === activeFolderId && !activeCollectionId ? 'page' : 'false')
      const entry = document.createElement('div')
      entry.className = 'tree-entry'
      entry.dataset.folderDocuments = folder.id
      const edit = createButton('⋯', () => openOrganizer('folder', folder.id), 'tree-edit-button')
      edit.setAttribute('aria-label', `Upraviť priečinok ${folder.title}`)
      entry.append(button, edit)
      container.append(entry)
      const documents = document.createElement('div')
      documents.className = 'folder-document-list'
      documents.id = `folder-documents-${folder.id}`
      documents.setAttribute('aria-label', `Dokumenty a podpriečinky: ${folder.title}`)
      documents.hidden = !expandedFolderIds.has(folder.id)
      button.setAttribute('aria-controls', documents.id)
      button.setAttribute('aria-expanded', String(!documents.hidden))
      container.append(documents)
      for (const storedDocument of grimoireStore.listDocuments(folder.id)) {
        const readable = sourceStore.getText(storedDocument.id) !== undefined ||
          canExtractDocumentText(storedDocument.name)
        const documentButton = createButton(storedDocument.name, () => {
          if (readable) {
            void prepareAndOpen(storedDocument.id, storedDocument.name, documentButton)
          } else {
            void downloadOriginal(storedDocument.id, storedDocument.name)
          }
        }, 'folder-document-button')
        documentButton.style.setProperty('--folder-depth', String(depth + 1))
        documentButton.title = storedDocument.name
        documentButton.setAttribute('aria-label', `${readable ? 'Čítať dokument' : 'Stiahnuť originál'} ${storedDocument.name}`)
        const documentIcon = document.createElement('span')
        documentIcon.className = 'document-icon'
        documentIcon.setAttribute('aria-hidden', 'true')
        documentIcon.innerHTML = icon('book')
        const documentName = document.createElement('span')
        documentName.textContent = storedDocument.name
        documentButton.replaceChildren(documentIcon, documentName)
        documents.append(documentButton)
      }
      renderFolderTree(folders, folder.id, depth + 1, documents)
      if (!documents.childElementCount) documents.append(createEmptyState('V tomto priečinku zatiaľ nie sú dokumenty.'))
    }
  }

  function collectionResults(collection: WordCollection): Array<{ sourceId: string; sourceTitle: string; occurrence?: SearchOccurrence }> {
    const results = new Map<string, { sourceId: string; sourceTitle: string; occurrence?: SearchOccurrence }>(searchSources(collection.word, sourceStore)
      .filter((result) => !collection.excludedDocumentIds.includes(result.sourceId))
      .map((result) => [result.sourceId, result]))
    const stored = grimoireStore.listTabs().flatMap((tab) => grimoireStore.listFolders(tab.id))
      .flatMap((folder) => grimoireStore.listDocuments(folder.id))
    for (const id of collection.includedDocumentIds) {
      const document = stored.find((item) => item.id === id)
      if (document && !collection.excludedDocumentIds.includes(id) && !results.has(id)) {
        results.set(id, { sourceId: id, sourceTitle: document.name })
      }
    }
    return [...results.values()]
  }

  function openCollectionDocument(
    collection: WordCollection,
    result: { sourceId: string; sourceTitle: string; occurrence?: SearchOccurrence },
  ): void {
    if (sourceStore.getText(result.sourceId) !== undefined) {
      openReader(result.sourceId, result.occurrence, collection.word)
    } else if (canExtractDocumentText(result.sourceTitle)) {
      const button = document.createElement('button')
      void prepareAndOpen(result.sourceId, result.sourceTitle, button, collection.word)
    } else {
      void downloadOriginal(result.sourceId, result.sourceTitle)
    }
  }

  function appendCollectionDocuments(collection: WordCollection, container: HTMLElement): void {
    for (const result of collectionResults(collection)) {
      const button = createButton(result.sourceTitle,
        () => openCollectionDocument(collection, result), 'folder-document-button collection-document')
      button.title = sourceStore.getText(result.sourceId) === undefined && !canExtractDocumentText(result.sourceTitle)
        ? 'Stiahnuť originál; tento formát zatiaľ nemá čítačku.' : 'Čítať dokument'
      button.style.setProperty('--folder-depth', '1')
      container.append(button)
    }
  }

  function openCollection(collection: WordCollection): void {
    expandedTabId = collection.parentTabId
    activeCollectionId = collection.id
    activeTabId = collection.parentTabId
    activeFolderId = null
    renderLibrary()
  }

  function editCollection(collection: WordCollection): void {
    openCollection(collection)
    folderContentPanel.querySelector<HTMLInputElement>('.folder-details-title')?.focus()
  }

  async function uploadCollectionDocuments(collectionId: string, input: HTMLInputElement): Promise<void> {
    if (collectionUploadBusy) return
    const files = Array.from(input.files ?? [])
    if (!files.length) return
    const collection = collections.list().find((item) => item.id === collectionId)
    if (!collection) {
      operationStatus.textContent = 'Slovná kolekcia už nie je dostupná.'
      return
    }
    collectionUploadBusy = true
    input.disabled = true
    const accepted: string[] = []
    const failed: string[] = []
    let folderId: string | undefined
    try {
      for (const file of files) {
        try {
          if (!isSupportedDocument(file.name)) throw new Error('Nepodporovaný formát súboru.')
          if (file.size > 50 * 1024 * 1024) throw new Error('Súbor prekračuje limit 50 MB.')
          if (!folderId) {
            const folders = grimoireStore.listTabs().flatMap((tab) => grimoireStore.listFolders(tab.id))
            folderId = folders.find((folder) => folder.id === collection.uploadFolderId)?.id
            if (!folderId) {
              const tab = collection.parentTabId
                ? grimoireStore.listTabs().find((item) => item.id === collection.parentTabId)
                : grimoireStore.listTabs().find((item) => item.title === 'Nahraté dokumenty')
              const destination = tab ?? await grimoireStore.createTab('Nahraté dokumenty')
              const folder = await grimoireStore.createFolder(destination.id, null, `${collection.title.slice(0, 60)} – originály`)
              folderId = folder.id
            }
          }
          if (collections.list().find((item) => item.id === collection.id)?.uploadFolderId !== folderId) {
            await collections.setUploadFolder(collection.id, folderId)
          }
          operationStatus.textContent = `Nahrávam ${file.name} do kolekcie „${collection.title}“…`
          await storeUploadedDocument(folderId, file, collection.id)
          accepted.push(file.name)
        } catch (error) {
          failed.push(`${file.name}: ${errorMessage(error)}`)
        }
      }
    } finally {
      collectionUploadBusy = false
      input.disabled = false
      root.querySelectorAll<HTMLInputElement>('.collection-upload-input').forEach((field) => { field.disabled = false })
      input.value = ''
      if (activeCollectionId === collection.id && readerPanel.hidden) renderLibrary()
      renderResults()
      if (!readerPanel.hidden) hideSearchPopup()
      operationStatus.textContent = [
        accepted.length ? `Pridané do kolekcie: ${accepted.join(', ')}.` : '',
        failed.length ? `Nepodarilo sa pridať: ${failed.join('; ')}.` : '',
      ].filter(Boolean).join(' ')
    }
  }

  async function storeUploadedDocument(folderId: string, file: File, collectionId?: string): Promise<void> {
    if (file.size > 50 * 1024 * 1024) throw new Error('Súbor prekračuje limit 50 MB.')
    const extracted = canExtractDocumentText(file.name) ? await extractDocumentText(file) : undefined
    const stored = await grimoireStore.addDocument(folderId, file)
    try {
      if (extracted) {
        await sourceStore.addTextDocument({
          id: stored.id, title: stored.name, kind: 'document', createdAt: stored.addedAt,
        }, extracted.text, extracted.pages)
      }
      if (collectionId) await collections.include(collectionId, stored.id)
    } catch (error) {
      let detail = errorMessage(error)
      try {
        await grimoireStore.removeDocument(stored.id)
        sourceStore.forgetDocuments([stored.id])
      } catch (cleanupError) {
        detail += ` Originál mohol zostať v priečinku „${findDocumentLocation(stored.id)?.path ?? folderId}“; odstránenie po chybe zlyhalo: ${errorMessage(cleanupError)}`
      }
      throw new Error(detail)
    }
  }

  function createFolderEditor(
    title: string,
    note: string,
    titleLimit: number,
    saveDetails: (title: string, note: string) => Promise<void>,
    isCurrent: () => boolean,
  ): HTMLDetailsElement {
    const form = document.createElement('form')
    form.className = 'favorite-note-form folder-details-form'
    const titleLabel = document.createElement('label')
    titleLabel.textContent = 'Názov'
    const titleInput = document.createElement('input')
    titleInput.className = 'folder-details-title'
    titleInput.type = 'text'
    titleInput.required = true
    titleInput.maxLength = titleLimit
    titleInput.value = title
    titleLabel.append(titleInput)
    const noteLabel = document.createElement('label')
    noteLabel.textContent = 'Vlastný text (najviac 500 znakov)'
    const noteInput = document.createElement('textarea')
    noteInput.className = 'folder-details-note'
    noteInput.maxLength = 500
    noteInput.rows = 3
    noteInput.value = note
    noteLabel.append(noteInput)
    const save = document.createElement('button')
    save.type = 'submit'
    save.className = 'text-button'
    save.textContent = 'Uložiť zmeny'
    const status = document.createElement('p')
    status.className = 'operation-message'
    status.setAttribute('role', 'status')
    form.addEventListener('input', () => { status.textContent = 'Neuložené zmeny.' })
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      save.disabled = titleInput.disabled = noteInput.disabled = true
      status.textContent = 'Ukladám…'
      try {
        await saveDetails(titleInput.value, noteInput.value)
        if (isCurrent() && readerPanel.hidden) {
          renderLibrary()
          const feedback = folderContentPanel.querySelector<HTMLElement>('.folder-details-form .operation-message')
          if (feedback) feedback.textContent = 'Zmeny uložené.'
        }
      } catch (error) {
        const message = `Zmeny sa nepodarilo uložiť: ${errorMessage(error)}`
        status.textContent = message
        if (!form.isConnected || !isCurrent()) operationStatus.textContent = message
      } finally {
        save.disabled = titleInput.disabled = noteInput.disabled = false
      }
    })
    form.append(titleLabel, noteLabel, save, status)
    const details = document.createElement('details')
    details.className = 'folder-details'
    const summary = document.createElement('summary')
    summary.textContent = 'Upraviť názov a poznámku'
    details.append(summary, form)
    return details
  }

  const renderResults = (): LibrarySearch => {
    clearTimeout(resultsTimer)
    const allDocuments = grimoireStore.listTabs().flatMap((tab) =>
      grimoireStore.listFolders(tab.id).flatMap((folder) => grimoireStore.listDocuments(folder.id)))
    const pending = allDocuments.filter((item) => canExtractDocumentText(item.name) && sourceStore.getText(item.id) === undefined)
    indexButton.hidden = pending.length === 0
    indexStatus.textContent = ''
    const combined = searchLibrary(input.value, sourceStore, grimoireStore, options.mapNodes?.(), options.sourceErrors?.(),
      options.externalSources?.(input.value))
    const folders = searchDestinations(input.value, grimoireStore.listTabs(),
      grimoireStore.listTabs().flatMap(tab => grimoireStore.listFolders(tab.id)))
    indexStatus.textContent = combined.errors.length ? `Čiastočný katalóg: ${combined.errors.join(' ')}` : ''
    const results = combined.documents
    updateSearchPopup()
    resultCount.textContent = String(results.length + combined.nodes.length + folders.length)
    resultList.replaceChildren()
    resultList.setAttribute('aria-busy', 'false')
    for (const error of combined.errors) {
      const warning = document.createElement('p')
      warning.className = 'operation-message'
      warning.setAttribute('role', 'alert')
      warning.textContent = `Čiastočné výsledky: ${error}`
      resultList.append(warning)
    }

    if (!isSearchQueryReady(input.value)) {
      resultList.append(createEmptyState('Vyhľadávanie sa začne od 3 písmen. Hľadá sa obsah dokumentov, priečinky a terminológia.'))
      return combined
    }
    if (results.length === 0 && combined.nodes.length === 0 && folders.length === 0) {
      resultList.append(createEmptyState(`Pre „${input.value.trim()}“ sa nenašli zhody v dostupných zdrojoch.`))
      return combined
    }

    const pendingCards: Array<() => HTMLElement> = []
    const query = input.value
    for (const result of results) pendingCards.push(() => {
      const card = document.createElement('article')
      card.className = 'result-card'
      const sourceLink = document.createElement('a')
      sourceLink.className = 'result-source'
      sourceLink.href = `#document-${encodeURIComponent(result.documentId)}`
      sourceLink.textContent = result.title
      sourceLink.addEventListener('click', (event) => {
        event.preventDefault()
        void openStoredDocument(result.documentId, query)
          .catch(error => { operationStatus.textContent = `Dokument sa neotvoril: ${errorMessage(error)}` })
      })
      card.append(sourceLink)
      const location = findDocumentLocation(result.documentId)
      if (location) {
        const path = document.createElement('p')
        path.className = 'result-location'
        path.textContent = location.path
        card.append(path)
      }

      if (result.occurrence?.pageNumber !== undefined) {
        const pageLabel = document.createElement('span')
        pageLabel.className = 'result-page'
        pageLabel.textContent = `Strana ${result.occurrence.pageNumber}`
        card.append(pageLabel)
      }

      const excerpt = document.createElement('p')
      excerpt.className = 'result-excerpt'
      excerpt.textContent = result.excerpt
      card.append(excerpt)
      return card
    })
    const navigationCard = (kind: 'folder' | 'term', title: string, detail: string, open: () => void): HTMLButtonElement => {
      const button = createButton('', open, `search-navigation search-navigation-${kind}`)
      const icon = document.createElement('span')
      icon.className = 'search-navigation-icon'
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML = kind === 'folder'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7V5h6l2 2h10v12H3Z"/><path d="M3 10h18"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="18" r="3"/><circle cx="19" cy="18" r="3"/><path d="m10.5 7.5-4 8m7-8 4 8M8 18h8"/></svg>'
      const body = document.createElement('span')
      body.className = 'search-navigation-body'
      const label = document.createElement('small')
      label.textContent = kind === 'folder' ? 'Priečinok v Grimoári' : 'Termín v Mape stromu'
      const name = document.createElement('strong')
      name.textContent = title
      const context = document.createElement('span')
      context.textContent = detail
      body.append(label, name, context)
      const arrow = document.createElement('span')
      arrow.className = 'search-navigation-arrow'
      arrow.textContent = '→'
      arrow.setAttribute('aria-hidden', 'true')
      button.append(icon, body, arrow)
      return button
    }
    for (const folder of folders) pendingCards.push(() => {
      const button = navigationCard('folder', folder.title, 'Otvoriť priečinok', () => {
        closeReader()
        activeCollectionId = null
        activeTabId = folder.tabId
        activeFolderId = folder.id
        renderLibrary()
        hideSearchPopup()
      })
      return button
    })
    for (const node of combined.nodes) pendingCards.push(() => {
      const button = navigationCard('term', node.term, node.title, () => options.onMapNode?.(node))
      button.classList.add('result-map-node')
      return button
    })
    let nextCard = 0
    resultList.setAttribute('aria-busy', 'true')
    const appendBatch = (): void => {
      const fragment = document.createDocumentFragment()
      const end = Math.min(nextCard + 12, pendingCards.length)
      while (nextCard < end) fragment.append(pendingCards[nextCard++]())
      resultList.append(fragment)
      if (nextCard < pendingCards.length) resultsTimer = setTimeout(appendBatch, 50)
      else resultList.setAttribute('aria-busy', 'false')
    }
    appendBatch()
    return combined
  }

  addTabButton.addEventListener('click', () => {
    tabForm.hidden = !tabForm.hidden
    if (!tabForm.hidden) tabTitle.focus()
  })
  tabForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    try {
      const tab = await grimoireStore.createTab(tabTitle.value)
      activeCollectionId = null
      activeTabId = tab.id
      expandedTabId = tab.id
      activeFolderId = null
      tabTitle.value = ''
      tabForm.hidden = true
      operationMessage.textContent = ''
      renderLibrary()
    } catch (error) {
      operationMessage.textContent = `Záložku sa nepodarilo uložiť: ${errorMessage(error)}`
    }
  })
  addFolderButton.addEventListener('click', () => {
    folderForm.hidden = !folderForm.hidden
    if (!folderForm.hidden) folderTitle.focus()
  })
  folderForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!activeTabId) return
    if (activeCollectionId) {
      operationStatus.textContent = 'V slovnej kolekcii nemožno vytvárať bežné podpriečinky. Vyberte pôvodnú záložku.'
      return
    }
    try {
      await grimoireStore.createFolder(activeTabId, activeFolderId, folderTitle.value)
      if (activeFolderId) expandedFolderIds.add(activeFolderId)
      folderTitle.value = ''
      folderForm.hidden = true
      operationMessage.textContent = ''
      renderLibrary()
    } catch (error) {
      operationMessage.textContent = `Priečinok sa nepodarilo uložiť: ${errorMessage(error)}`
    }
  })
  documentInput.addEventListener('change', async () => {
    const folder = getActiveFolder()
    if (!folder) {
      uploadMessage.textContent = 'Najprv vyberte priečinok, do ktorého chcete uložiť dokumenty.'
      documentInput.value = ''
      return
    }

    const accepted: string[] = []
    const rejected: string[] = []
    const failed: string[] = []
    for (const file of Array.from(documentInput.files ?? [])) {
      if (!isSupportedDocument(file.name)) {
        rejected.push(file.name)
        continue
      }

      try {
        uploadMessage.textContent = `Načítavam ${file.name} lokálne…`
        await storeUploadedDocument(folder.id, file)
        accepted.push(file.name)
      } catch (error) {
        failed.push(`${file.name}: ${errorMessage(error)}`)
      }
    }
    documentInput.value = ''
    renderLibrary()
    uploadMessage.textContent = [
      accepted.length > 0 ? `Pridané: ${accepted.join(', ')}.` : '',
      rejected.length > 0 ? `Nepodporované súbory: ${rejected.join(', ')}.` : '',
      failed.length > 0 ? `Nepodarilo sa načítať: ${failed.join(', ')}.` : '',
    ].filter(Boolean).join(' ')
    renderResults()
  })
  indexButton.addEventListener('click', async () => {
    indexButton.disabled = true
    const failures: string[] = []
    let indexed = 0
    try {
      for (const tab of grimoireStore.listTabs()) {
        for (const folder of grimoireStore.listFolders(tab.id)) {
          for (const item of grimoireStore.listDocuments(folder.id)) {
            if (!canExtractDocumentText(item.name) || sourceStore.getText(item.id) !== undefined) continue
            indexingStatus.textContent = `Spracúvam ${item.name}…`
            try { await prepareDocument(item.id, item.name); indexed += 1 }
            catch (error) { failures.push(`${item.name}: ${errorMessage(error)}`) }
          }
        }
      }
      renderLibrary()
      renderResults()
      operationStatus.textContent = `Spracované dokumenty: ${indexed}.${failures.length ? ` Chyby: ${failures.join('; ')}` : ''}`
    } finally {
      indexButton.disabled = false
    }
  })
  readerClose.addEventListener('click', () => {
    closeReader()
    input.focus({ preventScroll: true })
  })
  const rewardStatus = root.querySelector<HTMLElement>('#reader-reward-status')!
  const rewardRetry = root.querySelector<HTMLButtonElement>('#reader-reward-retry')!
  const rewardProgress = root.querySelector<HTMLElement>('#reader-reward-progress')!
  const rewardBar = root.querySelector<HTMLProgressElement>('#reader-reward-bar')!
  const rewardCount = root.querySelector<HTMLElement>('#reader-reward-count')!
  const rewardTotal = root.querySelector<HTMLElement>('#reader-reward-total')!
  let pendingReadingTurn: { eventId: string; documentId: string; fromPage: number; toPage: number } | undefined
  const queuedReadingTurns: NonNullable<typeof pendingReadingTurn>[] = []
  let scrollReadingAnchor = 0
  let scrollReadingHeight = 0
  let scrollReadingIntentUntil = 0
  function resetScrollReadingTracking(): void {
    scrollReadingAnchor = readerText.scrollTop
    scrollReadingHeight = readerText.clientHeight
    scrollReadingIntentUntil = 0
  }
  let readingTurnSaving = false
  let readingProgressSerial = 0
  const showReadingProgress = (result: { turns: number; towardsReward: number; awarded?: boolean }): void => {
    rewardProgress.hidden = false
    rewardBar.value = result.towardsReward
    rewardBar.setAttribute('aria-valuetext', `${result.towardsReward} z 25 otočení k ďalšej korune`)
    rewardCount.textContent = `${result.towardsReward} / 25`
    rewardTotal.textContent = `Celkovo otočené strany: ${result.turns} · 25 otočení = 1 koruna`
    rewardStatus.textContent = `${result.awarded ? 'Pripísaná 1 koruna. ' : ''}Listovanie: ${result.towardsReward}/25 k ďalšej korune. Počíta sa aj opakovanie. Pri posúvaní prejdi celú výšku čítačky od posledného započítania.`
  }
  if (options.readingReward) void options.readingReward.status().then(result => {
    if (!pendingReadingTurn && readingProgressSerial === 0) showReadingProgress(result)
  }).catch(error => { if (!pendingReadingTurn && readingProgressSerial === 0) rewardStatus.textContent = `Počítadlo listovania: ${errorMessage(error)}` })
  const confirmReadingTurn = async (): Promise<void> => {
    if (!pendingReadingTurn || !options.readingReward || readingTurnSaving) return
    readingTurnSaving = true; readingProgressSerial += 1; rewardRetry.disabled = true
    rewardStatus.textContent = 'Potvrdzujem otočenie strany…'
    try {
      while (pendingReadingTurn) {
        await saveReadingPosition()
        const result = await options.readingReward.turn(pendingReadingTurn)
        pendingReadingTurn = queuedReadingTurns.shift(); rewardRetry.hidden = true
        showReadingProgress(result)
      }
    } catch (error) {
      rewardStatus.textContent = `Otočenie zatiaľ nie je potvrdené: ${errorMessage(error)} Zopakuj potvrdenie; ďalšie celé posuny čakajú na potvrdenie. Nezatváraj stránku.`
      rewardRetry.hidden = false
    } finally { readingTurnSaving = false; rewardRetry.disabled = false; updateReadingControls() }
  }
  rewardRetry.addEventListener('click', () => { void confirmReadingTurn() })
  const warnPendingReading = (event: BeforeUnloadEvent): void => {
    if (pendingReadingTurn) { event.preventDefault(); event.returnValue = '' }
  }
  window.addEventListener('beforeunload', warnPendingReading)
  const turnPage = async (direction: number): Promise<void> => {
    if (!pagedReading || pendingReadingTurn || !readingDocumentId) return
    const fromPage = currentPage
    if (readingPages.length) {
      currentPage = Math.max(0, Math.min(readingPages.length - 1, currentPage + direction))
      readingPages.forEach((page, index) => { page.hidden = index !== currentPage })
      readerText.scrollTop = 0
      updateReadingControls()
    } else {
      currentPage = Math.max(0, Math.min(longTextPageCount() - 1, currentPage + direction))
      readerText.scrollLeft = currentPage * pageStride()
      updateReadingControls()
    }
    if (currentPage !== fromPage && options.readingReward) {
      pendingReadingTurn = {eventId:crypto.randomUUID(),documentId:readingDocumentId,fromPage:fromPage + 1,toPage:currentPage + 1}
      updateReadingControls()
    }
    if (pendingReadingTurn) await confirmReadingTurn()
    else await saveReadingPosition()
  }
  readerPrevious.addEventListener('click', () => { void turnPage(-1) })
  readerNext.addEventListener('click', () => { void turnPage(1) })
  readerClearMarker.addEventListener('pointerenter', () => { markerTooltip.hidden = false })
  readerClearMarker.addEventListener('pointerleave', () => { markerTooltip.hidden = true })
  readerClearMarker.addEventListener('focus', () => { markerTooltip.hidden = false })
  readerClearMarker.addEventListener('blur', () => { markerTooltip.hidden = true })
  readerClearMarker.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') markerTooltip.hidden = true
  })
  readerClearMarker.addEventListener('click', () => { void changeReadingMarker(undefined) })
  readerOriginalVersion.addEventListener('click', () => { void changeReaderVersion('original') })
  readerEditedVersion.addEventListener('click', () => { void changeReaderVersion('edited') })
  readerEditorToggle.addEventListener('click', () => {
    if (!readingDocumentId || !editedTextLoaded) return
    editorOpen = true
    readerEditorPanel.hidden = false
    readerEditorToggle.textContent = 'Upraviť v Pracovni'
    readerEditorToggle.setAttribute('aria-expanded', 'true')
    setGrimoireView('workbench')
    workbench.selectSource('document')
    if (editorOpen) {
      mountRichEditor(readingDocumentId, getEditorDraft(readingDocumentId))
      readerEditorStatus.textContent = 'Upravený text sa uloží samostatne od originálu.'
      updateEditorSaveState()
      richEditors.get(readingDocumentId)?.focus()
    }
  })
  readerEditorText.addEventListener('input', () => {
    if (!readingDocumentId) return
    editedTextByDocument.set(readingDocumentId, readerEditorText.value)
    readerEditorStatus.textContent = 'Neuložené zmeny zostávajú v pamäti tejto stránky.'
    updateEditorSaveState()
  })
  readerEditorSave.addEventListener('click', () => { void saveEditedText() })
  readerText.addEventListener('dblclick', () => {
    if (readingVersion !== 'original') {
      markerFeedback.textContent = 'Značku možno uložiť iba v origináli. Prepnite na Originál; upravená verzia používa iné pozície textu.'
      return
    }
    const marker = markerFromSelection(readerText, readerText.ownerDocument.getSelection())
    if (marker) void changeReadingMarker(marker)
    else markerFeedback.textContent = 'Dvojkliknite priamo na slovo v texte originálu.'
  })
  const setReadingMode = (paged: boolean): void => {
    const position = captureReadingPosition()
    pagedReading = paged
    readerScroll.setAttribute('aria-pressed', String(!paged))
    readerPaged.setAttribute('aria-pressed', String(paged))
    applyReadingLayout(position)
    void saveReadingPosition()
  }
  readerScroll.addEventListener('click', () => setReadingMode(false))
  readerPaged.addEventListener('click', () => setReadingMode(true))
  const noteScrollReadingIntent = (): void => { scrollReadingIntentUntil = performance.now() + 1500 }
  readerText.addEventListener('wheel', noteScrollReadingIntent, { passive: true })
  readerText.addEventListener('touchmove', noteScrollReadingIntent, { passive: true })
  readerText.addEventListener('pointerdown', noteScrollReadingIntent)
  readerText.addEventListener('pointermove', event => { if (event.buttons) noteScrollReadingIntent() })
  readerText.addEventListener('scrollend', () => { scrollReadingIntentUntil = 0 })
  readerText.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) noteScrollReadingIntent()
  })
  readerText.addEventListener('scroll', () => {
    if (!readingDocumentId) return
    updateReadingControls()
    window.clearTimeout(savePositionTimer)
    if (!pagedReading && options.readingReward) {
      const height = readerText.clientHeight
      if (height <= 0 || height !== scrollReadingHeight || performance.now() > scrollReadingIntentUntil) {
        resetScrollReadingTracking()
      } else {
        let distance = readerText.scrollTop - scrollReadingAnchor
        while (Math.abs(distance) >= height) {
          const direction = Math.sign(distance)
          const fromPage = Math.max(0, Math.floor(scrollReadingAnchor / height))
          scrollReadingAnchor += direction * height
          const turn = {
            eventId: crypto.randomUUID(), documentId: readingDocumentId,
            fromPage: fromPage + 1, toPage: fromPage + 1 + direction,
          }
          if (pendingReadingTurn) queuedReadingTurns.push(turn)
          else pendingReadingTurn = turn
          distance = readerText.scrollTop - scrollReadingAnchor
        }
        if (pendingReadingTurn && !readingTurnSaving && rewardRetry.hidden) void confirmReadingTurn()
      }
    }
    if (!pendingReadingTurn) savePositionTimer = window.setTimeout(() => { void saveReadingPosition() }, 250)
  })
  let readerWidth = 0
  let readerHeight = 0
  const readerResize = new ResizeObserver(() => {
    if (!readerText.isConnected) { readerResize.disconnect(); return }
    const width = readerText.clientWidth
    const height = readerText.clientHeight
    // Hidden host frames are not a reader resize; keep the live scroll position.
    if (width === 0 || height === 0) return
    if (readingDocumentId && width > 0 && height > 0 && (width !== readerWidth || height !== readerHeight)) {
      const position = readingVersion === 'edited'
        ? editedPositions.get(readingDocumentId)
        : positions.get(readingDocumentId)
      if (position) applyReadingLayout(position)
    }
    readerWidth = width
    readerHeight = height
  })
  readerResize.observe(readerText)
  signOutButton.addEventListener('click', async () => {
    if (!options.onSignOut) return
    signOutButton.disabled = true
    try {
      await saveReadingPosition()
      closeReader()
      await options.onSignOut()
    } catch (error) {
      operationMessage.textContent = `Odhlásenie zlyhalo: ${errorMessage(error)}`
      signOutButton.disabled = false
    }
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    closeReader()
    renderResults()
    showSearchPopup()
  })
  input.addEventListener('input', () => {
    closeReader()
    renderResults()
    showSearchPopup()
    options.onQueryChange?.(input.value)
  })
  renderLibrary()
  renderResults()
  workbench.activate()

  const destroyScreenPager = mountScreenPager(root)
  let externalOpenPending = false
  options.onReady?.({
    cancelPendingOpen() { if (externalOpenPending) readerRequest += 1 },
    refresh() {
      if (readingDocumentId || editorOpen) return
      renderLibrary(); renderResults()
    },
    search(query) {
      input.value = query
      return renderResults()
    },
    openDocument: openStoredDocument,
  })

  async function openStoredDocument(documentId: string, query = ''): Promise<void> {
      if (readingDocumentId === documentId && !query) return
      const stored = grimoireStore.listTabs().flatMap(tab => grimoireStore.listFolders(tab.id))
        .flatMap(folder => grimoireStore.listDocuments(folder.id)).find(item => item.id === documentId)
      if (!stored) throw new Error('Dokument s týmto identifikátorom už nie je dostupný.')
      const request = ++readerRequest
      externalOpenPending = true
      try {
        await prepareDocument(documentId, stored.name)
        if (request !== readerRequest) throw new Error('Otvorenie nahradila novšia navigácia. Rozpísaný obsah zostal zachovaný.')
        const occurrence = query
          ? searchSources(query, sourceStore).find(item => item.sourceId === documentId)?.occurrence : undefined
        openReader(documentId, occurrence, query)
      } finally { externalOpenPending = false }
  }

  return () => {
    clearTimeout(resultsTimer)
    clearTimeout(searchCloseTimer)
    if (searchResults.matches(':popover-open')) searchResults.hidePopover()
    window.removeEventListener('resize', positionSearchPopup)
    document.removeEventListener('pointermove', trackSearchPointer)
    root.removeEventListener('pointerleave', closeSearchLater)
    destroyScreenPager()
    window.removeEventListener('pagehide', returnPanels)
    workbench.destroy()
    window.removeEventListener('beforeunload', warnPendingReading)
    closeReader()
    readerResize.disconnect()
    for (const rich of richEditors.values()) rich.editor.destroy()
    richEditors.clear()
  }

  function closeReader(): void {
    workbench.clearDocument()
    markerRevision += 1
    editedTextRevision += 1
    markerTooltip.hidden = true
    void saveReadingPosition()
    richReader?.destroy()
    richReader = undefined
    readingDocumentId = null
    editedTextLoaded = false
    editedTextLoading = false
    editorToggle.disabled = true
    editorPanel.hidden = true
    editorOpen = false
    window.clearTimeout(savePositionTimer)
    readerRequest += 1
    readerPanel.hidden = true
    updateLibraryGuide()
    readerText.replaceChildren()
    libraryPanel.hidden = false
    updateSearchPopup()
  }

  async function loadEditedText(documentId: string, readerRequestId: number, versionRequest: number): Promise<void> {
    try {
      const text = await editedTexts.get(documentId)
      if (readingDocumentId !== documentId || readerRequest !== readerRequestId || editedTextRevision !== versionRequest) return
      savedEditedText = text
      editedTextLoaded = true
      editedTextLoading = false
      editorText.value = getEditorDraft(documentId)
      mountRichEditor(documentId, editorText.value)
      editorPanel.hidden = false
      editorBaseline = richEditors.get(documentId)!.canonicalValue(text ?? encodeDocument(plainDocument(originalReadingText)))
      editorStatus.textContent = editedTextByDocument.has(documentId)
        ? 'Rozpracovaný návrh bol obnovený z pamäte tejto stránky.'
        : text === undefined
        ? 'Zatiaľ nie je uložená upravená verzia.'
        : 'Načítaná uložená upravená verzia.'
      updateReaderVersionControls()
      updateEditorSaveState()
    } catch (error) {
      if (readingDocumentId !== documentId || readerRequest !== readerRequestId || editedTextRevision !== versionRequest) return
      editedTextLoading = false
      const message = `Upravenú verziu sa nepodarilo načítať: ${errorMessage(error)}`
      editorStatus.textContent = message
      positionFeedback.textContent = message
      editorToggle.disabled = true
      editorText.disabled = true
      editorSave.disabled = true
      editedVersionButton.disabled = true
      versionNote.textContent = 'Upravená verzia nie je dostupná, pretože sa ju nepodarilo načítať. Originál zostáva nezmenený.'
    }
  }

  function getEditorDraft(documentId: string): string {
    if (editedTextByDocument.has(documentId)) return editedTextByDocument.get(documentId) ?? ''
    return savedEditedText ?? encodeDocument(plainDocument(originalReadingText))
  }

  function updateReaderVersionControls(): void {
    const isOriginal = readingVersion === 'original'
    originalVersionButton.setAttribute('aria-pressed', String(isOriginal))
    editedVersionButton.setAttribute('aria-pressed', String(!isOriginal))
    originalVersionButton.classList.toggle('is-active', isOriginal)
    editedVersionButton.classList.toggle('is-active', !isOriginal)
    originalVersionButton.disabled = editedTextLoading
    editedVersionButton.disabled = editedTextLoading || !editedTextLoaded || savedEditedText === undefined
    clearMarkerButton.disabled = !isOriginal
    editorToggle.disabled = editedTextLoading || !editedTextLoaded
    editorText.disabled = editedTextLoading || !editedTextLoaded
    editorSave.disabled = editedTextLoading || !editedTextLoaded
    versionNote.textContent = isOriginal
      ? 'Originál je iba na čítanie. Vyhľadávanie a značka čítania sa vzťahujú na pôvodný text.'
      : 'Zobrazuje sa upravená verzia. Vyhľadávanie, značka čítania a uložené miesto sa vzťahujú iba na originál.'
    updateEditorSaveState()
  }

  function updateEditorSaveState(): void {
    if (!readingDocumentId) {
      editorSave.disabled = true
      return
    }
    const baseline = editorBaseline
    const text = editorText.value
    try {
      validateEditedText(text)
      editorSave.disabled = !editedTextLoaded || editedTextLoading || editedSaves.has(readingDocumentId) || text === baseline
      if (editorText.validationMessage) editorText.setCustomValidity('')
    } catch (error) {
      editorSave.disabled = true
      editorText.setCustomValidity(errorMessage(error))
      editorStatus.textContent = errorMessage(error)
    }
  }

  async function saveEditedText(): Promise<void> {
    const documentId = readingDocumentId
    const requestId = readerRequest
    if (!documentId || !editedTextLoaded || editedSaves.has(documentId)) return
    const text = editorText.value
    try {
      validateEditedText(text)
    } catch (error) {
      editorStatus.textContent = errorMessage(error)
      return
    }

    editedSaves.add(documentId)
    editorSave.disabled = true
    editorStatus.textContent = 'Ukladám upravenú verziu…'
    try {
      await editedTexts.save(documentId, text)
      if (readingDocumentId === documentId && readerRequest === requestId) {
        const currentPosition = readingVersion === 'edited' ? captureReadingPosition() : undefined
        savedEditedText = text
        editorBaseline = text
        if (readingVersion === 'edited') {
          const source = sourceStore.listSources().find((candidate) => candidate.id === documentId)
          if (source) {
            renderReaderVersion(source)
            const position = currentPosition ?? { pageIndex: 0, scrollFraction: 0 }
            editedPositions.set(documentId, position)
            applyReadingLayout(position)
          }
        }
        updateReaderVersionControls()
        updateEditorSaveState()
        editorStatus.textContent = editorText.value === text
          ? 'Upravená verzia bola uložená. Originál sa nezmenil.'
          : 'Verzia bola uložená; novšie zmeny v editore ešte nie sú uložené.'
      }
    } catch (error) {
      if (readingDocumentId === documentId && readerRequest === requestId) {
        editedTextByDocument.set(documentId, editorText.value)
        editorStatus.textContent = `Upravenú verziu sa nepodarilo uložiť: ${errorMessage(error)}. Rozpracovaný text zostal zachovaný.`
        updateEditorSaveState()
      } else {
        operationStatus.textContent = `Upravenú verziu sa nepodarilo uložiť: ${errorMessage(error)}. Rozpracovaný text zostal v pamäti stránky.`
      }
    } finally {
      editedSaves.delete(documentId)
      if (readingDocumentId === documentId && readerRequest === requestId) updateEditorSaveState()
    }
  }

  async function changeReaderVersion(version: 'original' | 'edited'): Promise<void> {
    const documentId = readingDocumentId
    if (!documentId || version === readingVersion || !editedTextLoaded) return
    if (version === 'edited' && savedEditedText === undefined) return
    const currentPosition = captureReadingPosition()
    if (readingVersion === 'original') {
      await saveReadingPosition()
    } else {
      editedPositions.set(documentId, currentPosition)
    }
    if (readingDocumentId !== documentId) return

    window.clearTimeout(savePositionTimer)
    readingVersion = version
    markerRevision += 1
    const source = sourceStore.listSources().find((candidate) => candidate.id === documentId)
    if (!source) return
    renderReaderVersion(source, undefined, searchInput.value)
    const nextPosition = version === 'original'
      ? positions.get(documentId) ?? { pageIndex: 0, scrollFraction: 0 }
      : editedPositions.get(documentId) ?? { pageIndex: 0, scrollFraction: 0 }
    applyReadingLayout(nextPosition)
    if (version === 'original') {
      void restoreReadingMarker(documentId)
    } else {
      renderReadingMarker(readerText, undefined)
      markerFeedback.textContent = 'Značka čítania je viazaná iba na originál.'
    }
    updateReaderVersionControls()
    readerText.focus({ preventScroll: true })
  }

  async function changeReadingMarker(marker: ReadingMarker | undefined): Promise<void> {
    if (!readingDocumentId) return
    const documentId = readingDocumentId
    const revision = ++markerRevision
    markerFeedback.textContent = marker ? 'Ukladám značku čítania…' : 'Odstraňujem značku čítania…'
    try {
      await markers.set(documentId, marker)
      if (readingDocumentId !== documentId || revision !== markerRevision) return
      renderReadingMarker(readerText, marker)
      window.getSelection()?.removeAllRanges()
      markerFeedback.textContent = marker ? 'Značka čítania uložená.' : 'Značka čítania odstránená.'
    } catch (error) {
      const message = `Značku čítania sa nepodarilo ${marker ? 'uložiť' : 'odstrániť'}: ${errorMessage(error)}`
      if (readingDocumentId === documentId && revision === markerRevision) markerFeedback.textContent = message
      else operationStatus.textContent = message
    }
  }

  async function restoreReadingMarker(documentId: string): Promise<void> {
    const revision = ++markerRevision
    markerFeedback.textContent = 'Načítavam značku čítania…'
    try {
      const marker = await markers.get(documentId)
      if (readingDocumentId !== documentId || revision !== markerRevision) return
      const restored = renderReadingMarker(readerText, marker)
      markerFeedback.textContent = !restored
        ? 'Uložená značka už nezodpovedá textu dokumentu. Označte slovo znova.'
        : 'Dvojklikom na slovo označíte miesto, kde ste prestali čítať.'
    } catch (error) {
      if (readingDocumentId === documentId && revision === markerRevision) {
        markerFeedback.textContent = `Značku čítania sa nepodarilo načítať: ${errorMessage(error)}`
      }
    }
  }

  function readingFraction(): number {
    const maximum = readerText.scrollHeight - readerText.clientHeight
    return maximum > 0 ? Math.max(0, Math.min(1, readerText.scrollTop / maximum)) : 0
  }

  function pageStride(): number { return readerText.clientWidth + 32 }

  function longTextPageCount(): number {
    return Math.max(1, Math.ceil((readerText.scrollWidth + 32) / pageStride()))
  }

  function captureReadingPosition(): { pageIndex: number; scrollFraction: number } {
    if (readingPages.length) {
      if (!pagedReading) {
        const top = readerText.getBoundingClientRect().top + parseFloat(getComputedStyle(readerText).paddingTop)
        const visible = readingPages.findIndex((page) => page.getBoundingClientRect().bottom > top + 24)
        currentPage = Math.max(0, visible)
        const page = readingPages[currentPage]
        const fraction = page ? (top - page.getBoundingClientRect().top) / Math.max(1, page.offsetHeight) : 0
        return { pageIndex: currentPage, scrollFraction: Math.max(0, Math.min(1, fraction)) }
      }
      return { pageIndex: currentPage, scrollFraction: readingFraction() }
    }
    return {
      pageIndex: pagedReading ? currentPage : 0,
      scrollFraction: pagedReading ? currentPage / Math.max(1, longTextPageCount() - 1) : readingFraction(),
    }
  }

  function applyReadingLayout(position: { pageIndex: number; scrollFraction: number }): void {
    readerText.classList.toggle('is-paged', pagedReading)
    pagination.hidden = !pagedReading
    readerText.scrollTop = 0
    readerText.scrollLeft = 0
    if (readingPages.length) {
      currentPage = Math.max(0, Math.min(readingPages.length - 1, position.pageIndex))
      readingPages.forEach((page, index) => { page.hidden = pagedReading && index !== currentPage })
      if (pagedReading) {
        readerText.scrollTop = position.scrollFraction * (readerText.scrollHeight - readerText.clientHeight)
      } else {
        const page = readingPages[currentPage]
        readerText.scrollTop = page.getBoundingClientRect().top - readerText.getBoundingClientRect().top -
          parseFloat(getComputedStyle(readerText).paddingTop) + position.scrollFraction * page.offsetHeight
      }
    } else if (pagedReading) {
      currentPage = Math.round(position.scrollFraction * (longTextPageCount() - 1))
      readerText.scrollLeft = currentPage * pageStride()
    } else {
      currentPage = 0
      readerText.scrollTop = position.scrollFraction * (readerText.scrollHeight - readerText.clientHeight)
    }
    updateReadingControls()
    resetScrollReadingTracking()
  }

  async function saveReadingPosition(): Promise<void> {
    if (!readingDocumentId) return
    const id = readingDocumentId
    const position = captureReadingPosition()
    if (readingVersion === 'edited') {
      editedPositions.set(id, position)
      positionFeedback.textContent = 'Miesto v upravenej verzii sa uchová počas tejto návštevy; trvalé miesto patrí originálu.'
      return
    }
    try {
      await positions.save(id, position)
      if (readingDocumentId === id) positionFeedback.textContent = 'Miesto čítania uložené.'
    } catch (error) {
      if (readingDocumentId === id) positionFeedback.textContent = `Miesto čítania sa nepodarilo uložiť: ${errorMessage(error)}`
      operationStatus.textContent = `Miesto čítania sa nepodarilo uložiť: ${errorMessage(error)}`
    }
  }

  function updateReadingControls(): void {
    if (readingPages.length) {
      positionLabel.textContent = `${currentPage + 1} / ${readingPages.length}`
      previousPage.disabled = currentPage === 0
      nextPage.disabled = currentPage === readingPages.length - 1
    } else if (pagedReading) {
      positionLabel.textContent = `${currentPage + 1} / ${longTextPageCount()}`
      previousPage.disabled = currentPage === 0
      nextPage.disabled = currentPage === longTextPageCount() - 1
    }
    if (pendingReadingTurn) { previousPage.disabled = true; nextPage.disabled = true }
  }

  function openOrganizer(kind: 'tab' | 'folder', id: string): void {
    const tabs = grimoireStore.listTabs()
    const folders = tabs.flatMap((tab) => grimoireStore.listFolders(tab.id))
    const entity = kind === 'tab' ? tabs.find((tab) => tab.id === id) : folders.find((folder) => folder.id === id)
    if (!entity) {
      operationStatus.textContent = 'Zvolená položka už nie je dostupná.'
      return
    }
    const dialog = document.createElement('dialog')
    dialog.className = 'organizer-dialog'
    const heading = document.createElement('h2')
    heading.textContent = kind === 'tab' ? 'Upraviť záložku' : 'Upraviť priečinok'
    const rename = document.createElement('form')
    const nameLabel = document.createElement('label')
    nameLabel.textContent = 'Názov'
    const name = document.createElement('input')
    name.value = entity.title
    name.maxLength = 80
    name.required = true
    nameLabel.append(name)
    const submit = document.createElement('button')
    submit.type = 'submit'
    submit.textContent = 'Uložiť názov'
    rename.append(nameLabel, submit)
    const feedback = document.createElement('p')
    feedback.setAttribute('role', 'status')
    const cancel = createButton('Zavrieť', () => dialog.close(), 'text-button')
    dialog.append(heading, rename)
    let busy = false
    const run = async (action: () => Promise<void>, message: string): Promise<void> => {
      if (busy) return
      busy = true
      dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select')
        .forEach((control) => { control.disabled = true })
      const beforeIds = grimoireStore.listTabs().flatMap((tab) => grimoireStore.listFolders(tab.id))
        .flatMap((folder) => grimoireStore.listDocuments(folder.id)).map((document) => document.id)
      feedback.textContent = 'Spracúvam…'
      try {
        await saveReadingPosition()
        readingDocumentId = null
        closeReader()
        await action()
        renderLibrary()
        operationStatus.textContent = message
        dialog.close()
      } catch (error) {
        feedback.textContent = `Operácia zlyhala: ${errorMessage(error)}`
      } finally {
        const remaining = new Set(grimoireStore.listTabs().flatMap((tab) => grimoireStore.listFolders(tab.id))
          .flatMap((folder) => grimoireStore.listDocuments(folder.id)).map((document) => document.id))
        sourceStore.forgetDocuments(beforeIds.filter((sourceId) => !remaining.has(sourceId)))
        renderLibrary()
        renderResults()
        dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select')
          .forEach((control) => { control.disabled = false })
        busy = false
      }
    }
    rename.addEventListener('submit', (event) => {
      event.preventDefault()
      void run(async () => {
        if (kind === 'tab') await grimoireStore.renameTab(id, name.value)
        else await grimoireStore.renameFolder(id, name.value)
      }, 'Názov bol uložený.')
    })
    if (kind === 'folder') {
      const folder = folders.find((item) => item.id === id)
      if (!folder) throw new Error('Priečinok už nie je dostupný.')
      const subtree = folderSubtreeIds(folders, id)
      const merge = document.createElement('form')
      const targetLabel = document.createElement('label')
      targetLabel.textContent = 'Zlúčiť do priečinka v rovnakej záložke'
      const target = document.createElement('select')
      target.required = true
      const placeholder = document.createElement('option')
      placeholder.value = ''
      placeholder.textContent = 'Vyberte cieľový priečinok'
      target.append(placeholder)
      for (const candidate of folders.filter((item) => item.tabId === folder.tabId && !subtree.has(item.id))) {
        const option = document.createElement('option')
        option.value = candidate.id
        const path = [candidate.title]
        const seen = new Set([candidate.id])
        let parentId = candidate.parentId
        while (parentId && !seen.has(parentId)) {
          seen.add(parentId)
          const parent = folders.find((item) => item.id === parentId)
          if (!parent) break
          path.unshift(parent.title)
          parentId = parent.parentId
        }
        option.textContent = path.join(' → ')
        target.append(option)
      }
      targetLabel.append(target)
      const mergeButton = document.createElement('button')
      mergeButton.type = 'submit'
      mergeButton.textContent = 'Presunúť obsah a zlúčiť'
      const mergeHint = document.createElement('p')
      mergeHint.textContent = 'Všetky dokumenty a podpriečinky sa presunú do cieľa. Rovnomenné položky zostanú samostatné; pôvodný priečinok zanikne.'
      merge.append(targetLabel, mergeHint, mergeButton)
      merge.addEventListener('submit', (event) => {
        event.preventDefault()
        if (!target.value) { feedback.textContent = 'Vyberte cieľový priečinok.'; return }
        void run(async () => {
          await grimoireStore.mergeFolders(id, target.value)
          activeFolderId = target.value
        }, 'Priečinky boli zlúčené bez prepisovania dokumentov.')
      })
      const deletion = document.createElement('form')
      const warning = document.createElement('p')
      const confirmedDocuments = folders.filter((item) => subtree.has(item.id))
        .flatMap((item) => grimoireStore.listDocuments(item.id)).map((document) => document.id)
      const documentCount = confirmedDocuments.length
      warning.textContent = `Odstrániť „${folder.title}“: ${subtree.size} priečinkov a ${documentCount} dokumentov vrátane originálov. Odstránenie je trvalé.`
      const confirmLabel = document.createElement('label')
      const confirmation = document.createElement('input')
      confirmation.type = 'checkbox'
      confirmation.required = true
      confirmLabel.append(confirmation, document.createTextNode('Potvrdzujem odstránenie priečinka aj celého jeho obsahu.'))
      const deleteButton = document.createElement('button')
      deleteButton.type = 'submit'
      deleteButton.className = 'danger-button'
      deleteButton.textContent = 'Odstrániť priečinok aj obsah'
      deletion.append(warning, confirmLabel, deleteButton)
      deletion.addEventListener('submit', (event) => {
        event.preventDefault()
        if (!confirmation.checked) { feedback.textContent = 'Najprv potvrďte odstránenie celého obsahu.'; return }
        void run(async () => {
          await grimoireStore.deleteFolder(id, confirmedDocuments)
          activeFolderId = folder.parentId
        }, 'Priečinok aj jeho obsah boli odstránené.')
      })
      dialog.append(merge, deletion)
    }
    dialog.append(feedback, cancel)
    dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault() })
    dialog.addEventListener('close', () => dialog.remove(), { once: true })
    root.append(dialog)
    dialog.showModal()
    name.focus()
  }

  async function prepareDocument(documentId: string, name: string): Promise<void> {
    if (sourceStore.getText(documentId) !== undefined) return
    const pending = pendingExtractions.get(documentId)
    if (pending) return pending
    const extraction = (async () => {
      const blob = await grimoireStore.downloadDocument(documentId)
      const extracted = await extractDocumentText(new File([blob], name, { type: blob.type }))
      const stored = grimoireStore.listTabs().flatMap((tab) => grimoireStore.listFolders(tab.id))
        .flatMap((folder) => grimoireStore.listDocuments(folder.id)).find((item) => item.id === documentId)
      if (!stored) throw new Error('Dokument už nie je dostupný.')
      await sourceStore.addTextDocument({
        id: documentId, title: name, kind: 'document', createdAt: stored.addedAt,
      }, extracted.text, extracted.pages)
    })()
    pendingExtractions.set(documentId, extraction)
    try {
      await extraction
    } finally {
      pendingExtractions.delete(documentId)
    }
  }

  async function prepareAndOpen(documentId: string, name: string, button: HTMLButtonElement, query?: string): Promise<void> {
    const request = ++readerRequest
    button.disabled = true
    operationStatus.textContent = `Otváram ${name}…`
    try {
      await prepareDocument(documentId, name)
      renderResults()
      if (request === readerRequest) openReader(documentId, undefined, query)
      operationStatus.textContent = ''
    } catch (error) {
      operationStatus.textContent = `Dokument sa nepodarilo otvoriť: ${errorMessage(error)}`
    } finally {
      button.disabled = false
    }
  }
  function openReader(sourceId: string, occurrence?: SearchOccurrence, query = searchInput.value): void {
    const text = sourceStore.getText(sourceId)
    const source = sourceStore.listSources().find((candidate) => candidate.id === sourceId)
    if (text === undefined || !source) {
      operationStatus.textContent = 'Text dokumentu nie je dostupný na čítanie.'
      return
    }

    setGrimoireView('reading')
    closeReader()
    const location = findDocumentLocation(sourceId)
    if (location) {
      activeCollectionId = null
      activeTabId = location.tabId
      activeFolderId = location.folderId
      expandedFolderIds.add(location.folderId)
      renderLibrary()
    }

    readerHeading.textContent = source.title
    readingDocumentId = sourceId
    readingVersion = 'original'
    originalReadingText = text
    savedEditedText = undefined
    editorBaseline = ''
    editedTextLoaded = false
    editedTextLoading = true
    editorOpen = false
    editorPanel.hidden = true
    editorToggle.textContent = 'Upraviť v Pracovni'
    editorToggle.setAttribute('aria-expanded', 'false')
    editorText.value = editedTextByDocument.get(sourceId) ?? text
    editorStatus.textContent = 'Načítavam uloženú upravenú verziu…'
    positionFeedback.textContent = ''
    const readerRequestId = readerRequest
    const versionRequest = ++editedTextRevision
    const selectedMark = renderReaderVersion(source, occurrence, query)
    libraryPanel.hidden = false
    updateSearchPopup()
    readerPanel.hidden = false
    updateLibraryGuide()
    const saved = positions.get(sourceId)
    const foundPage = occurrence
      ? sourceStore.getTextSegments(sourceId).findIndex((segment) => segment.id === occurrence.segmentId)
      : -1
    if (occurrence) {
      pagedReading = false
      scrollModeButton.setAttribute('aria-pressed', 'true')
      pagedModeButton.setAttribute('aria-pressed', 'false')
    }
    applyReadingLayout({
      pageIndex: foundPage >= 0 ? foundPage : saved?.pageIndex ?? 0,
      scrollFraction: occurrence ? 0 : saved?.scrollFraction ?? 0,
    })
    positionFeedback.textContent = saved && !occurrence ? 'Obnovené posledné miesto čítania.' : ''
    updateReaderVersionControls()
    void restoreReadingMarker(sourceId)
    updateReadingControls()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    readerPanel.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
    readerText.focus({ preventScroll: true })
    if (selectedMark && pagedReading && !readingPages.length) {
      const offset = selectedMark.getBoundingClientRect().left - readerText.getBoundingClientRect().left + readerText.scrollLeft
      currentPage = Math.max(0, Math.min(longTextPageCount() - 1, Math.floor(offset / pageStride())))
      readerText.scrollLeft = currentPage * pageStride()
      updateReadingControls()
    } else {
      selectedMark?.scrollIntoView({ behavior: 'auto', block: 'center' })
    }
    resetScrollReadingTracking()
    void saveReadingPosition()
    void loadEditedText(sourceId, readerRequestId, versionRequest)
  }

  function renderReaderVersion(
    source: { id: string; title: string },
    occurrence?: SearchOccurrence,
    query = searchInput.value,
  ): HTMLElement | undefined {
    richReader?.destroy()
    richReader = undefined
    readerText.replaceChildren()
    readingPages = []
    if (readingVersion === 'edited') {
      readerText.classList.remove('has-pages')
      const content = document.createElement('div')
      content.className = 'saved-rich-document'
      readerText.append(content)
      richReader = renderRichDocument(content, savedEditedText ?? '')
      return undefined
    }

    const segments = sourceStore.getTextSegments(source.id)
    const matches = searchSources(query, sourceStore)
      .filter((result) => result.sourceId === source.id)
      .map((result) => result.occurrence)
    let selectedMark: HTMLElement | undefined
    const appendHighlightedText = (container: HTMLElement, segmentId: string, content: string): void => {
      container.dataset.segmentIndex = String(segments.findIndex((segment) => segment.id === segmentId))
      const ranges = matches.filter((match) => match.segmentId === segmentId)
      if (occurrence?.segmentId === segmentId) ranges.push(occurrence)
      ranges.sort((left, right) => left.startOffset - right.startOffset || right.endOffset - left.endOffset)
      let cursor = 0
      for (const match of ranges) {
        if (match.startOffset < cursor || match.endOffset > content.length || match.endOffset <= match.startOffset) continue
        container.append(document.createTextNode(content.slice(cursor, match.startOffset)))
        const mark = document.createElement('mark')
        mark.textContent = content.slice(match.startOffset, match.endOffset)
        if (occurrence?.segmentId === segmentId &&
          match.startOffset <= occurrence.startOffset && match.endOffset >= occurrence.endOffset) {
          mark.className = 'selected-search-match'
          selectedMark = mark
        }
        container.append(mark)
        cursor = match.endOffset
      }
      container.append(document.createTextNode(content.slice(cursor)))
    }

    const hasPdfPages = segments.some((segment) => segment.pageNumber !== undefined)
    readerText.classList.toggle('has-pages', hasPdfPages)
    if (hasPdfPages) {
      for (const segment of segments) {
        const page = document.createElement('section')
        page.className = 'reader-page'
        if (segment.pageNumber !== undefined) {
          page.id = `reader-page-${segment.pageNumber}`
          const pageHeading = document.createElement('h4')
          pageHeading.textContent = `Strana ${segment.pageNumber}`
          page.append(pageHeading)
        }
        const pageText = document.createElement('p')
        appendHighlightedText(pageText, segment.id, segment.text)
        if (!segment.text) pageText.textContent = 'Na tejto strane sa nenašla textová vrstva.'
        page.append(pageText)
        readerText.append(page)
        readingPages.push(page)
      }
    } else {
      for (const segment of segments) {
        const paragraph = document.createElement('p')
        paragraph.className = 'reader-paragraph'
        appendHighlightedText(paragraph, segment.id, segment.text)
        readerText.append(paragraph)
      }
    }
    return selectedMark
  }

  async function downloadOriginal(documentId: string, fileName: string): Promise<void> {
    operationStatus.textContent = `Sťahujem ${fileName}…`
    try {
      const blob = await grimoireStore.downloadDocument(documentId)
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = fileName
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      operationStatus.textContent = `Originál „${fileName}“ bol stiahnutý.`
    } catch (error) {
      operationStatus.textContent = `Originál sa nepodarilo stiahnuť: ${errorMessage(error)}`
    }
  }
}

function createButton(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  button.addEventListener('click', onClick)
  return button
}

function createEmptyState(message: string): HTMLElement {
  const emptyState = document.createElement('p')
  emptyState.className = 'empty-state'
  emptyState.textContent = message
  return emptyState
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Neznáma chyba.'
}
