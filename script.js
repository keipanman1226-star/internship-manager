// ================================================
// インターン応募管理アプリ本体
// データはブラウザの localStorage に保存する。
// localStorage は「文字列」しか保存できないので、
// 配列やオブジェクトは JSON.stringify / JSON.parse で変換して使う。
// ================================================

// localStorageに保存するときのキー名(自由な名前でOK)
const STORAGE_KEY = "internships";

// 選考状況の並び順(グラフやセレクトボックスの並びをこの順番にそろえる)
// 「未応募→通過/不合格/辞退」という選考の流れの順になっている
const STATUS_ORDER = [
  "未応募", "ES提出済み", "書類選考中", "面接予定", "面接中", "最終面接", "通過", "不合格", "辞退",
];

// 選考状況ごとの色(グラフの棒・フェーズ一覧・カードのバッジで共通利用)
const STATUS_COLORS = {
  未応募: "#c3c2b7",
  ES提出済み: "#2a78d6",
  書類選考中: "#eda100",
  面接予定: "#4a3aa7",
  面接中: "#1baf7a",
  最終面接: "#eb6834",
  通過: "#0ca30c",
  不合格: "#d03b3b",
  辞退: "#898781",
};

// 「インターン内容」の固定の分類(分析グラフの集計対象と一致させる)
const INTERNSHIP_TYPE_CATEGORIES = [
  "データ分析", "AI・機械学習", "システム開発", "Web開発", "マーケティング", "コンサル", "営業", "その他",
];

// インターン内容ごとの色(カテゴリカラーを固定の順番で割り当てる)
const TYPE_COLORS = {
  データ分析: "#2a78d6",
  "AI・機械学習": "#1baf7a",
  システム開発: "#eda100",
  Web開発: "#008300",
  マーケティング: "#4a3aa7",
  コンサル: "#e34948",
  営業: "#e87ba4",
  その他: "#898781",
};

// 業界別グラフで使う色(登場順に固定の色を割り当てる。9業界目以降はグレーで表示)
const INDUSTRY_PALETTE = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];
const INDUSTRY_FALLBACK_COLOR = "#898781";

// カレンダーに自由に登録できる予定の種類と色
// (企業の応募情報とは別に管理する、自分だけのカレンダー予定)
const CUSTOM_EVENT_CATEGORIES = ["面接", "説明会", "ES提出", "大学", "その他"];
const CUSTOM_EVENT_COLORS = {
  面接: "#2a78d6",
  説明会: "#1baf7a",
  ES提出: "#eda100",
  大学: "#0ca30c",
  その他: "#898781",
};

// カレンダーの自由な予定を保存するキー(応募データとは別のキーで管理する)
const CUSTOM_EVENTS_KEY = "internship-manager-custom-events";

function loadCustomEvents() {
  const raw = localStorage.getItem(CUSTOM_EVENTS_KEY);
  return raw ? JSON.parse(raw) : [];
}
function saveCustomEvents(events) {
  localStorage.setItem(CUSTOM_EVENTS_KEY, JSON.stringify(events));
}

// ================================================
// 過去バージョンのデータを、新しい項目・新しい選考状況名に合わせて変換する処理
// (アプリを更新しても、これまで保存してきたデータが消えたり壊れたりしないようにするため)
// ================================================

// 以前の選考状況名 → 新しい選考状況名
const STATUS_MIGRATION_MAP = {
  応募済み: "ES提出済み",
  内定: "通過",
};

// 以前の「インターン内容」の自由入力 → 新しい固定の分類
const TYPE_MIGRATION_MAP = {
  データ分析: "データ分析",
  システム開発: "システム開発",
  営業: "営業",
  マーケティング: "マーケティング",
  コンサルティング: "コンサル",
};

function migrateItem(item) {
  const status = STATUS_MIGRATION_MAP[item.status] || item.status;
  const rawType = (item.internshipType || "").trim();
  const internshipType = INTERNSHIP_TYPE_CATEGORIES.includes(rawType)
    ? rawType
    : TYPE_MIGRATION_MAP[rawType] || "その他";

  // 旧バージョンでは「インターン参加日」が1日分(internshipDate)しかなかった。
  // 新バージョンでは開始日・終了日を持つので、旧データは「1日だけの期間」として引き継ぐ
  const { internshipDate, ...rest } = item;
  const internshipStartDate = item.internshipStartDate || internshipDate || "";
  const internshipEndDate = item.internshipEndDate || internshipDate || internshipStartDate || "";

  return {
    ...rest,
    status,
    internshipType,
    infoSessionDate: item.infoSessionDate || "",
    internshipName: item.internshipName || "",
    internshipStartDate,
    internshipEndDate,
    mypageUrl: item.mypageUrl || "",
    mypageIdEnc: item.mypageIdEnc || null,
    mypagePasswordEnc: item.mypagePasswordEnc || null,
  };
}

// 応募データから「インターン参加期間」を取り出す共通ヘルパー。
// 終了日が未入力なら開始日と同じ(1日だけ)とみなす。期間が設定されていなければnullを返す
function getInternshipRange(item) {
  const start = item.internshipStartDate;
  if (!start) return null;
  let end = item.internshipEndDate || start;
  if (end < start) end = start; // 終了日が開始日より前という誤入力を防ぐ
  return { start, end };
}

// 指定した日付を含む週の日曜日を返す(週表示カレンダーの起点を求めるために使う)
function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

// ================================================
// マイページのID・パスワードを暗号化して保存する仕組み
//
// この端末の中でしか使わない前提で、以下の方針にしている:
// ・可能なら端末の生体認証(指紋/顔認証など)を使い、そこから暗号鍵を作る
//   (WebAuthnのPRF拡張という仕組みを使う。対応ブラウザ/端末でのみ有効)
// ・生体認証が使えない場合は、自分で決めた「パスコード」から暗号鍵を作る
// ・どちらの方法でも、暗号鍵そのものは保存せず、毎回その場で作り直す
// ・一度認証したら、しばらく(10分間)は再認証なしで閲覧・コピーできるようにする
// ================================================

const SECURITY_CONFIG_KEY = "internship-manager-security";
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 認証の有効時間(10分)

// 復号した鍵は、ページを開いている間だけメモリ上に置く(保存はしない)
let sessionCryptoKey = null;
let sessionKeyExpiresAt = 0;

// ---- 文字列 <-> バイナリ の変換ヘルパー ----
function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ---- 認証方法の設定を読み書きする(暗号鍵そのものは含まれない) ----
function getSecurityConfig() {
  const raw = localStorage.getItem(SECURITY_CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}
function saveSecurityConfig(config) {
  localStorage.setItem(SECURITY_CONFIG_KEY, JSON.stringify(config));
}

// ---- WebAuthn(生体認証)で暗号鍵を作る ----
// 対応していないブラウザ/端末では例外が発生するので、呼び出し側でフォールバックする
async function createWebAuthnSecurity() {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "インターン応募管理" },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: "internship-manager-user",
        displayName: "インターン応募管理",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
      extensions: { prf: {} },
    },
  });

  const prfResult = credential.getClientExtensionResults().prf;
  if (!prfResult || !prfResult.enabled) {
    throw new Error("この端末・ブラウザは生体認証からの暗号鍵作成(PRF)に対応していません");
  }

  return {
    method: "webauthn",
    credentialId: bufferToBase64(credential.rawId),
    salt: bufferToBase64(salt),
  };
}

// 登録済みのWebAuthn認証情報を使って、生体認証を求めたうえで暗号鍵を取り出す
async function getWebAuthnKey(config) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: base64ToBuffer(config.credentialId), type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
      extensions: { prf: { eval: { first: base64ToBuffer(config.salt) } } },
    },
  });

  const prfResult = assertion.getClientExtensionResults().prf;
  if (!prfResult || !prfResult.results || !prfResult.results.first) {
    throw new Error("生体認証からの暗号鍵の取得に失敗しました");
  }

  return crypto.subtle.importKey("raw", prfResult.results.first, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// ---- パスコード(文字列)から暗号鍵を作る(生体認証が使えない場合の代替手段) ----
async function derivePasscodeKey(passcode, saltBase64) {
  const salt = base64ToBuffer(saltBase64);
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(passcode), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ---- AES-GCMでの暗号化・復号(毎回ランダムなIVを使うことで安全性を高める) ----
async function encryptWithKey(key, plainText) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plainText));
  return { iv: bufferToBase64(iv), data: bufferToBase64(data) };
}
async function decryptWithKey(key, encObj) {
  const iv = base64ToBuffer(encObj.iv);
  const data = base64ToBuffer(encObj.data);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plainBuffer);
}

// ---- パスコードの入力・設定用モーダルをPromiseで扱えるようにする ----
function askPasscode({ mode }) {
  // mode: "setup"(新規設定・確認入力あり) または "unlock"(入力のみ)
  return new Promise((resolve) => {
    passcodeTitle.textContent = mode === "setup" ? "パスコードを設定" : "パスコードを入力";
    passcodeDescription.textContent =
      mode === "setup"
        ? "マイページのID・パスワードを暗号化して保存するためのパスコードを設定してください。このパスコードはこの端末にしか保存されず、忘れると保存したパスワードは復元できません。"
        : "マイページのID・パスワードを見るには、設定したパスコードを入力してください。";
    passcodeConfirmRow.hidden = mode !== "setup";
    passcodeSubmitBtn.textContent = mode === "setup" ? "設定する" : "解除する";
    passcodeError.hidden = true;
    passcodeInput.value = "";
    passcodeConfirmInput.value = "";

    const cleanup = () => {
      passcodeForm.removeEventListener("submit", onSubmit);
      passcodeCancelBtn.removeEventListener("click", onCancel);
      passcodeCloseBtn.removeEventListener("click", onCancel);
      passcodeModal.removeEventListener("close", onCancel);
    };
    const onCancel = () => {
      cleanup();
      if (passcodeModal.open) passcodeModal.close();
      resolve(null);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      const value = passcodeInput.value;
      if (mode === "setup" && value !== passcodeConfirmInput.value) {
        passcodeError.textContent = "パスコードが一致しません";
        passcodeError.hidden = false;
        return;
      }
      if (value.length < 4) {
        passcodeError.textContent = "4文字以上で入力してください";
        passcodeError.hidden = false;
        return;
      }
      cleanup();
      passcodeModal.close();
      resolve(value);
    };

    passcodeForm.addEventListener("submit", onSubmit);
    passcodeCancelBtn.addEventListener("click", onCancel);
    passcodeCloseBtn.addEventListener("click", onCancel);
    passcodeModal.addEventListener("close", onCancel, { once: true });

    passcodeModal.showModal();
    passcodeInput.focus();
  });
}

// ---- 初回の認証方法セットアップ(生体認証を試し、ダメならパスコード) ----
async function setupSecurity() {
  if (window.PublicKeyCredential) {
    try {
      const config = await createWebAuthnSecurity();
      saveSecurityConfig(config);
      return getWebAuthnKey(config);
    } catch (error) {
      // 生体認証が使えない/キャンセルされた場合はパスコード方式にフォールバックする
    }
  }

  const passcode = await askPasscode({ mode: "setup" });
  if (passcode === null) return null; // キャンセルされた

  const salt = bufferToBase64(crypto.getRandomValues(new Uint8Array(16)));
  saveSecurityConfig({ method: "passcode", salt });
  return derivePasscodeKey(passcode, salt);
}

// ---- 今すぐ使える暗号鍵を用意する(必要なら認証を求める。10分間はキャッシュを使う) ----
async function ensureUnlocked() {
  const now = Date.now();
  if (sessionCryptoKey && now < sessionKeyExpiresAt) {
    return sessionCryptoKey;
  }

  const config = getSecurityConfig();
  let key;
  if (!config) {
    key = await setupSecurity();
  } else if (config.method === "webauthn") {
    try {
      key = await getWebAuthnKey(config);
    } catch (error) {
      throw new Error("生体認証がキャンセルされたか失敗しました");
    }
  } else {
    const passcode = await askPasscode({ mode: "unlock" });
    if (passcode === null) return null;
    key = await derivePasscodeKey(passcode, config.salt);
  }

  if (!key) return null;
  sessionCryptoKey = key;
  sessionKeyExpiresAt = now + SESSION_TIMEOUT_MS;
  return key;
}

// ---- マイページのID・パスワードをまとめて暗号化/復号する ----
async function encryptMypageField(plainText) {
  if (!plainText) return null;
  const key = await ensureUnlocked();
  if (!key) return null;
  return encryptWithKey(key, plainText);
}
async function decryptMypageField(encObj) {
  if (!encObj) return "";
  const key = await ensureUnlocked();
  if (!key) throw new Error("認証が完了しませんでした");
  try {
    return await decryptWithKey(key, encObj);
  } catch (error) {
    // 復号に失敗した鍵(パスコード違いなど)をキャッシュしたままにしない。
    // これをしないと、次にもう一度試したいときに再入力の機会がないまま失敗し続けてしまう
    sessionCryptoKey = null;
    sessionKeyExpiresAt = 0;
    throw new Error("復号に失敗しました(パスコードが違う可能性があります)");
  }
}

// ---- 画面右下に小さく出す通知(コピー完了など) ----
let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2000);
}

// ---- クリップボードへのコピー(スマホのブラウザでも極力成功するよう、何段階かの方法を試す) ----
//
// 生体認証やパスコード入力に時間がかかると、ブラウザが「ユーザーが今まさに操作した」と
// 認識する有効期限が切れてしまい、特にスマホのブラウザでは navigator.clipboard による
// コピーが黙って失敗することがある。そのため、失敗したら別の方法に切り替える。
async function copyTextToClipboard(text) {
  // 方法1: 標準のClipboard API
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    // 失敗しても諦めず、次の方法を試す
  }

  // 方法2: 古いブラウザでも動く方法(見えない入力欄を作って選択し、コピーする)
  try {
    const tempInput = document.createElement("input");
    tempInput.value = text;
    tempInput.readOnly = true;
    tempInput.style.position = "fixed";
    tempInput.style.top = "-1000px";
    tempInput.style.opacity = "0";
    document.body.appendChild(tempInput);
    tempInput.focus();
    tempInput.select();
    tempInput.setSelectionRange(0, text.length);
    const succeeded = document.execCommand("copy");
    document.body.removeChild(tempInput);
    if (succeeded) return true;
  } catch (error) {
    // それでもダメなら次へ
  }

  return false;
}

// 現在選択されている絞り込み条件("all"のときはすべて表示)
let currentIndustryFilter = "all";
let currentTypeFilter = "all";
let currentSearchText = "";

// 現在表示中のビュー("list" または "calendar")
let currentView = "list";

// カレンダーで表示中の月(常に月の1日を指すDateにしておく)
let calendarMonth = (() => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
})();

// カレンダーの表示モード("month"=月表示 / "week"=週表示)と、週表示のときの起点(その週の日曜日)
let calendarViewMode = "month";
let calendarWeekStart = getWeekStart(new Date());

// 直前にrenderAll()で計算した絞り込み済みデータ(月を切り替えるときに再利用する)
let lastFilteredItems = [];

// ---- HTMLの要素を先に取得しておく ----
const form = document.getElementById("internship-form");
const editIdInput = document.getElementById("edit-id");
const companyInput = document.getElementById("company");
const industryInput = document.getElementById("industry");
const industrySuggestions = document.getElementById("industry-suggestions");
const internshipTypeInput = document.getElementById("internship-type");
const deadlineInput = document.getElementById("deadline");
const statusInput = document.getElementById("status");
const infoSessionDateInput = document.getElementById("info-session-date");
const interviewDateInput = document.getElementById("interview-date");
const internshipNameInput = document.getElementById("internship-name");
const internshipStartDateInput = document.getElementById("internship-start-date");
const internshipEndDateInput = document.getElementById("internship-end-date");
const memoInput = document.getElementById("memo");

const mypageUrlInput = document.getElementById("mypage-url");
const mypageIdInput = document.getElementById("mypage-id");
const mypagePasswordInput = document.getElementById("mypage-password");
const mypagePasswordToggleBtn = document.getElementById("mypage-password-toggle");
const mypageLockNote = document.getElementById("mypage-lock-note");

const formTitle = document.getElementById("form-title");
const submitBtn = document.getElementById("submit-btn");
const cancelBtn = document.getElementById("cancel-btn");
const closeModalBtn = document.getElementById("close-modal-btn");
const openAddBtn = document.getElementById("open-add-btn");
const formModal = document.getElementById("form-modal");

const passcodeModal = document.getElementById("passcode-modal");
const passcodeForm = document.getElementById("passcode-form");
const passcodeTitle = document.getElementById("passcode-title");
const passcodeDescription = document.getElementById("passcode-description");
const passcodeInput = document.getElementById("passcode-input");
const passcodeConfirmRow = document.getElementById("passcode-confirm-row");
const passcodeConfirmInput = document.getElementById("passcode-confirm-input");
const passcodeError = document.getElementById("passcode-error");
const passcodeCancelBtn = document.getElementById("passcode-cancel-btn");
const passcodeCloseBtn = document.getElementById("passcode-close-btn");
const passcodeSubmitBtn = document.getElementById("passcode-submit-btn");

const eventModal = document.getElementById("event-modal");
const eventForm = document.getElementById("event-form");
const eventModalTitle = document.getElementById("event-modal-title");
const eventIdInput = document.getElementById("event-id");
const eventTitleInput = document.getElementById("event-title");
const eventDateInput = document.getElementById("event-date");
const eventCategoryInput = document.getElementById("event-category");
const eventMemoInput = document.getElementById("event-memo");
const eventDeleteBtn = document.getElementById("event-delete-btn");
const eventCancelBtn = document.getElementById("event-cancel-btn");
const eventCloseBtn = document.getElementById("event-close-btn");

const toastEl = document.getElementById("toast");

const industryFilterSelect = document.getElementById("industry-filter");
const typeFilterSelect = document.getElementById("type-filter");
const searchInput = document.getElementById("search-input");

const statGrid = document.getElementById("stat-grid");
const agendaList = document.getElementById("agenda-list");
const rankingList = document.getElementById("ranking-list");
const phaseList = document.getElementById("phase-list");
const phaseTotal = document.getElementById("phase-total");
const funnelEl = document.getElementById("funnel");
const industryBreakdownEl = document.getElementById("industry-breakdown");
const typeBreakdownEl = document.getElementById("type-breakdown");

const listContainer = document.getElementById("internship-list");
const listCount = document.getElementById("list-count");
const emptyMessage = document.getElementById("empty-message");

const viewTabs = document.querySelectorAll(".view-tab");
const listViewEl = document.getElementById("list-view");
const calendarViewEl = document.getElementById("calendar-view");
const calPrevBtn = document.getElementById("cal-prev");
const calNextBtn = document.getElementById("cal-next");
const calendarMonthLabel = document.getElementById("calendar-month-label");
const calendarGrid = document.getElementById("calendar-grid");
const calendarModeBtns = document.querySelectorAll(".calendar-mode-btn");

// ================================================
// localStorage とのやりとりをする関数
// ================================================

// 保存されているデータを全部取り出す関数
function loadInternships() {
  const jsonText = localStorage.getItem(STORAGE_KEY);
  if (!jsonText) {
    // まだ何も保存されていない場合は空の配列を返す
    return [];
  }
  // 文字列(JSON)を配列(JavaScriptのデータ)に変換したうえで、
  // 古いバージョンのデータ形式であれば新しい形式に変換する
  const raw = JSON.parse(jsonText);
  const migrated = raw.map(migrateItem);

  // 変換によって内容が変わっていたら、保存し直しておく(次回以降は変換不要になる)
  if (JSON.stringify(raw) !== JSON.stringify(migrated)) {
    saveInternships(migrated);
  }
  return migrated;
}

// 配列を丸ごとlocalStorageに保存する関数
function saveInternships(internships) {
  // 配列を文字列(JSON)に変換して保存する
  localStorage.setItem(STORAGE_KEY, JSON.stringify(internships));
}

// ================================================
// 画面全体を再描画する入り口の関数
// フィルターの選択肢・ダッシュボードの各カード・一覧・カレンダーは、
// すべてこの関数から呼び出して連動させる。
// ================================================
function renderAll() {
  const all = loadInternships();

  renderIndustryFilterOptions(all);
  renderTypeFilterOptions(all);
  renderIndustrySuggestions(all);

  let filtered = filterByIndustry(all, currentIndustryFilter);
  filtered = filterByType(filtered, currentTypeFilter);
  filtered = filterBySearch(filtered, currentSearchText);

  lastFilteredItems = filtered;

  renderAgenda(filtered);
  renderStatTiles(filtered);
  renderRanking(filtered);
  renderPhaseList(filtered);
  renderFunnel(filtered);
  renderIndustryBreakdown(filtered);
  renderTypeBreakdown(filtered);
  renderList(filtered);
  renderCalendar(filtered);
}

// 業界フィルターの値に応じてデータを絞り込む関数
function filterByIndustry(internships, industry) {
  if (industry === "all") return internships;
  return internships.filter((item) => (item.industry || "未分類") === industry);
}

// インターン内容フィルターの値に応じてデータを絞り込む関数
function filterByType(internships, type) {
  if (type === "all") return internships;
  return internships.filter((item) => item.internshipType === type);
}

// 企業名の検索キーワードでデータを絞り込む関数(部分一致・大文字小文字を区別しない)
function filterBySearch(internships, keyword) {
  const trimmed = keyword.trim().toLowerCase();
  if (!trimmed) return internships;
  return internships.filter((item) => item.company.toLowerCase().includes(trimmed));
}

// ================================================
// 業界・インターン内容フィルター(セレクトボックス)の描画
// ================================================
function renderIndustryFilterOptions(all) {
  // 登録されているデータから、重複のない業界名の一覧を作る
  const industries = Array.from(
    new Set(all.map((item) => (item.industry || "").trim() || "未分類"))
  ).sort((a, b) => a.localeCompare(b, "ja"));

  // 今選んでいる値を覚えておいて、作り直した後も選択を維持する
  const previousValue = industryFilterSelect.value || currentIndustryFilter;

  industryFilterSelect.innerHTML = '<option value="all">すべての業界</option>';
  industries.forEach((industry) => {
    const option = document.createElement("option");
    option.value = industry;
    option.textContent = industry;
    industryFilterSelect.appendChild(option);
  });

  // 前に選んでいた業界がまだ存在するなら、それを選び直す。なければ「すべて」に戻す
  if (industries.includes(previousValue) || previousValue === "all") {
    industryFilterSelect.value = previousValue;
    currentIndustryFilter = previousValue;
  } else {
    industryFilterSelect.value = "all";
    currentIndustryFilter = "all";
  }
}

// インターン内容フィルターの選択肢を作る(固定の分類一覧から)
function renderTypeFilterOptions() {
  const previousValue = typeFilterSelect.value || currentTypeFilter;

  typeFilterSelect.innerHTML = '<option value="all">すべての内容</option>';
  INTERNSHIP_TYPE_CATEGORIES.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    typeFilterSelect.appendChild(option);
  });

  if (INTERNSHIP_TYPE_CATEGORIES.includes(previousValue) || previousValue === "all") {
    typeFilterSelect.value = previousValue;
    currentTypeFilter = previousValue;
  } else {
    typeFilterSelect.value = "all";
    currentTypeFilter = "all";
  }
}

// 入力フォームの「業界」欄で過去の入力候補が出るようにする(datalist)
function renderIndustrySuggestions(all) {
  const industries = Array.from(
    new Set(all.map((item) => (item.industry || "").trim()).filter(Boolean))
  );
  industrySuggestions.innerHTML = "";
  industries.forEach((industry) => {
    const option = document.createElement("option");
    option.value = industry;
    industrySuggestions.appendChild(option);
  });
}

industryFilterSelect.addEventListener("change", () => {
  currentIndustryFilter = industryFilterSelect.value;
  renderAll();
});

typeFilterSelect.addEventListener("change", () => {
  currentTypeFilter = typeFilterSelect.value;
  renderAll();
});

searchInput.addEventListener("input", () => {
  currentSearchText = searchInput.value;
  renderAll();
});

// ================================================
// 締切までの残り日数を計算するための共通関数
// ================================================

// 今日の日付(時刻を0時0分にそろえて、日付だけで比較できるようにする)
function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

// 対象の日付と今日の差(日数)を計算する。マイナスなら過ぎている
function getDaysUntil(dateString) {
  if (!dateString) return null;
  const target = new Date(dateString);
  target.setHours(0, 0, 0, 0);
  const today = getToday();
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

// 残り日数を「あと3日」のような表示用の文字列に変換する関数
function formatDaysLabel(days) {
  if (days === null) return "";
  if (days < 0) return "締切超過";
  if (days === 0) return "本日締切";
  return `あと${days}日`;
}

// 残り日数に応じて、危険度を表すクラス名を返す関数(赤=締切超過/1日以内、オレンジ=3日以内)
function urgencyClass(days) {
  if (days === null) return "";
  if (days <= 1) return "urgent-critical";
  if (days <= 3) return "urgent-warning";
  return "";
}

// ================================================
// ①今週の予定
// 就活関連(応募企業のES締切・説明会・面接・インターン参加)の残り日数だけを
// カウントダウン形式でまとめて表示する。自分で自由に登録したカレンダーの予定はここには含めない。
// ================================================
const AGENDA_KIND_PHRASES = {
  deadline: "インターン応募締切",
  infoSession: "説明会",
  interview: "面接",
};

function renderAgenda(items) {
  const entries = [];
  items.forEach((item) => {
    [
      ["deadline", item.deadline],
      ["infoSession", item.infoSessionDate],
      ["interview", item.interviewDate],
    ].forEach(([kind, dateString]) => {
      const days = getDaysUntil(dateString);
      if (days !== null && days >= 0 && days <= 7) {
        entries.push({ kind, days, item });
      }
    });

    // インターン参加期間は「開始日までの残り日数」か「すでに参加期間中かどうか」で判定する
    // (単純な1日の予定と違い、開始日〜終了日のどこかに今日が入っていれば「参加中」として目立たせたい)
    const range = getInternshipRange(item);
    if (range) {
      const startDays = getDaysUntil(range.start);
      const endDays = getDaysUntil(range.end);
      const ongoing = startDays <= 0 && endDays >= 0;
      const upcoming = startDays > 0 && startDays <= 7;
      if (ongoing || upcoming) {
        entries.push({ kind: "internshipRange", days: ongoing ? 0 : startDays, ongoing, item });
      }
    }
  });

  // 残り日数が少ない(=締切・開始が近い)順に並べる
  entries.sort((a, b) => a.days - b.days);

  agendaList.innerHTML = "";

  if (entries.length === 0) {
    agendaList.innerHTML = '<p class="dashboard-empty">今週の予定はありません</p>';
    return;
  }

  entries.forEach(({ kind, days, ongoing, item }) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "agenda-row";

    const dayBadge = document.createElement("span");
    // 今日がインターン参加期間中の場合は、日数バッジの代わりに「本日参加中」を出して一番目立たせる
    dayBadge.className = `agenda-day-badge ${ongoing ? "urgent-critical" : urgencyClass(days)}`;
    dayBadge.textContent = ongoing ? "本日参加中" : formatDaysLabel(days);

    // 例:「〇〇株式会社 インターン応募締切まであと3日」の「まであと◯日」を除いた部分をここに表示する
    // (残り日数はすでに左のバッジで強調しているため)
    const textEl = document.createElement("span");
    textEl.className = "agenda-text";
    const strong = document.createElement("strong");
    strong.textContent = item.company;
    textEl.appendChild(strong);
    const phrase = kind === "internshipRange" ? `${item.internshipName || "インターン"}参加` : AGENDA_KIND_PHRASES[kind];
    textEl.appendChild(document.createTextNode(` ${phrase}`));

    row.appendChild(dayBadge);
    row.appendChild(textEl);
    row.addEventListener("click", () => startEdit(item.id));

    agendaList.appendChild(row);
  });
}

// ================================================
// ダッシュボード(統計タイル)の描画
// ================================================
function renderStatTiles(items) {
  const total = items.length;

  // ES(書類選考)通過率
  // 分子: 書類選考を通過して面接以降に進んだ件数
  // 分母: 書類選考の結果が出た件数(面接以降+不合格)。まだ結果待ちの案件は含めない
  const screeningPassed = items.filter((i) =>
    ["面接予定", "面接中", "最終面接", "通過"].includes(i.status)
  ).length;
  const esDecided = screeningPassed + items.filter((i) => i.status === "不合格").length;
  const esRate = esDecided === 0 ? null : Math.round((screeningPassed / esDecided) * 100);

  const inProgressCount = items.filter((i) =>
    ["書類選考中", "面接予定", "面接中", "最終面接"].includes(i.status)
  ).length;

  const finalPassCount = items.filter((i) => i.status === "通過").length;

  const tiles = [
    {
      label: "総応募数",
      value: `${total}件`,
      caption: null,
    },
    {
      label: "選考中",
      value: `${inProgressCount}件`,
      caption: "書類選考〜最終面接の合計",
    },
    {
      label: "ES通過率",
      value: esRate === null ? "ー" : `${esRate}%`,
      caption: esDecided === 0 ? "結果が出た応募がまだありません" : `${screeningPassed}/${esDecided}件 通過`,
      help: "ES通過率 = (面接予定+面接中+最終面接+通過) ÷ (面接予定+面接中+最終面接+通過+不合格)",
    },
    {
      label: "通過",
      value: `${finalPassCount}件`,
      caption: "最終的に通過した件数",
      help: "選考プロセスをすべて通過した件数",
    },
  ];

  statGrid.innerHTML = "";
  tiles.forEach((tile) => {
    const tileEl = document.createElement("div");
    tileEl.className = "stat-tile";

    const labelEl = document.createElement("div");
    labelEl.className = "stat-label";
    labelEl.textContent = tile.label;
    if (tile.help) {
      const helpEl = document.createElement("span");
      helpEl.className = "help-dot";
      helpEl.textContent = "?";
      helpEl.title = tile.help;
      labelEl.appendChild(helpEl);
    }

    const valueEl = document.createElement("div");
    valueEl.className = "stat-value";
    valueEl.textContent = tile.value;

    tileEl.appendChild(labelEl);
    tileEl.appendChild(valueEl);

    if (tile.caption) {
      const captionEl = document.createElement("div");
      captionEl.className = "stat-caption";
      captionEl.textContent = tile.caption;
      tileEl.appendChild(captionEl);
    }

    statGrid.appendChild(tileEl);
  });
}

// ================================================
// ③応募企業ランキング(締切が近い順トップ5)
// ================================================
function renderRanking(items) {
  const upcoming = items
    .map((item) => ({ item, days: getDaysUntil(item.deadline) }))
    .filter(({ days }) => days !== null && days >= 0)
    .sort((a, b) => a.days - b.days)
    .slice(0, 5);

  rankingList.innerHTML = "";

  if (upcoming.length === 0) {
    rankingList.innerHTML = '<p class="dashboard-empty">締切が近い応募はありません</p>';
    return;
  }

  upcoming.forEach(({ item, days }, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `ranking-row ${urgencyClass(days)}`;

    const rankEl = document.createElement("span");
    rankEl.className = "ranking-rank";
    rankEl.textContent = index + 1;

    const dayBadge = document.createElement("span");
    dayBadge.className = "ranking-day-badge";
    dayBadge.textContent = formatDaysLabel(days);

    const companyLabel = document.createElement("span");
    companyLabel.className = "ranking-company";
    companyLabel.textContent = item.company;

    row.appendChild(rankEl);
    row.appendChild(dayBadge);
    row.appendChild(companyLabel);
    row.addEventListener("click", () => startEdit(item.id));

    rankingList.appendChild(row);
  });
}

// ================================================
// 共通: ラベル・件数・割合・色を横棒で表示する部品
// (④選考フェーズ一覧 / ②業界別応募数 / ⑤インターン内容の分析 で共通利用)
// ================================================
function renderBarListInto(container, rows, total) {
  container.innerHTML = "";

  if (total === 0) {
    container.innerHTML = '<p class="dashboard-empty">表示できるデータがありません</p>';
    return;
  }

  rows.forEach(({ label, count, color }) => {
    const percent = total === 0 ? 0 : Math.round((count / total) * 100);

    const row = document.createElement("div");
    row.className = "hbar-row";

    const labelEl = document.createElement("div");
    labelEl.className = "hbar-label";
    labelEl.textContent = label;

    const track = document.createElement("div");
    track.className = "hbar-track";
    const fill = document.createElement("div");
    fill.className = "hbar-fill";
    fill.style.width = `${percent}%`;
    fill.style.backgroundColor = color;
    track.appendChild(fill);

    const valueEl = document.createElement("div");
    valueEl.className = "hbar-value";
    valueEl.textContent = `${count}件(${percent}%)`;

    row.appendChild(labelEl);
    row.appendChild(track);
    row.appendChild(valueEl);
    container.appendChild(row);
  });
}

// ④選考フェーズ一覧
function renderPhaseList(items) {
  phaseTotal.textContent = `合計 ${items.length}件`;
  const rows = STATUS_ORDER.map((status) => ({
    label: status,
    count: items.filter((i) => i.status === status).length,
    color: STATUS_COLORS[status],
  }));
  renderBarListInto(phaseList, rows, items.length);
}

// ②業界別応募数
function renderIndustryBreakdown(items) {
  const counts = new Map();
  items.forEach((item) => {
    const industry = (item.industry || "").trim() || "未分類";
    counts.set(industry, (counts.get(industry) || 0) + 1);
  });

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const rows = sorted.map(([industry, count], index) => ({
    label: industry,
    count,
    color: INDUSTRY_PALETTE[index] || INDUSTRY_FALLBACK_COLOR,
  }));

  renderBarListInto(industryBreakdownEl, rows, items.length);
}

// ⑤応募したインターンの種類の分析
function renderTypeBreakdown(items) {
  const rows = INTERNSHIP_TYPE_CATEGORIES.map((type) => ({
    label: type,
    count: items.filter((i) => i.internshipType === type).length,
    color: TYPE_COLORS[type],
  }));
  renderBarListInto(typeBreakdownEl, rows, items.length);
}

// ================================================
// ⑥選考ファネル(応募予定→通過までの人数の推移と、各段階の通過率)
// ================================================
function renderFunnel(items) {
  const total = items.length;
  const stages = [
    { label: "応募予定", count: total },
    { label: "ES提出", count: items.filter((i) => i.status !== "未応募").length },
    { label: "書類通過", count: items.filter((i) => ["面接予定", "面接中", "最終面接", "通過"].includes(i.status)).length },
    { label: "面接", count: items.filter((i) => ["面接中", "最終面接", "通過"].includes(i.status)).length },
    { label: "最終面接", count: items.filter((i) => ["最終面接", "通過"].includes(i.status)).length },
    { label: "通過", count: items.filter((i) => i.status === "通過").length },
  ];

  funnelEl.innerHTML = "";

  if (total === 0) {
    funnelEl.innerHTML = '<p class="dashboard-empty">表示できるデータがありません</p>';
    return;
  }

  const maxCount = stages[0].count || 1;

  stages.forEach((stage, index) => {
    if (index > 0) {
      const prevCount = stages[index - 1].count;
      const rate = prevCount === 0 ? null : Math.round((stage.count / prevCount) * 100);
      const rateEl = document.createElement("div");
      rateEl.className = "funnel-rate";
      rateEl.textContent = rate === null ? "↓" : `↓ 通過率 ${rate}%`;
      funnelEl.appendChild(rateEl);
    }

    const widthPercent = Math.max((stage.count / maxCount) * 100, stage.count > 0 ? 14 : 6);

    const bar = document.createElement("div");
    bar.className = "funnel-bar";
    bar.style.width = `${widthPercent}%`;
    bar.style.backgroundColor = STATUS_COLORS[stage.label] || "var(--accent)";

    const labelEl = document.createElement("span");
    labelEl.className = "funnel-bar-label";
    labelEl.textContent = stage.label;

    const countEl = document.createElement("span");
    countEl.className = "funnel-bar-count";
    countEl.textContent = `${stage.count}社`;

    bar.appendChild(labelEl);
    bar.appendChild(countEl);
    funnelEl.appendChild(bar);
  });
}

// ================================================
// 一覧表示に関する関数
// ================================================

// 一覧を「締切が近い順」に並び替えて画面に描画する関数
function renderList(items) {
  // 締切(deadline)が早い順に並び替える
  // Dateにして引き算すると、日付の前後関係を数字で比較できる
  const sorted = [...items].sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  listCount.textContent = `${sorted.length}件`;

  // 一覧を一旦空にしてから作り直す
  listContainer.innerHTML = "";

  // データが1件もない場合は「登録されていません」を表示
  if (sorted.length === 0) {
    emptyMessage.hidden = false;
    return;
  }
  emptyMessage.hidden = true;

  sorted.forEach((item) => {
    const card = createCard(item);
    listContainer.appendChild(card);
  });
}

// 1件分のデータから、表示用のカード(div要素)を作る関数
function createCard(item) {
  const card = document.createElement("div");
  card.className = "card";

  const days = getDaysUntil(item.deadline);
  let pillClass = "";
  if (days !== null) {
    if (days < 0) {
      pillClass = "over";
      card.classList.add("deadline-over");
    } else if (days <= 3) {
      pillClass = "soon";
    }
  }

  // 企業名や締切、選考状況バッジなどを表示する部分
  const range = getInternshipRange(item);
  const rangeText = range
    ? range.start === range.end
      ? formatDate(range.start)
      : `${formatDate(range.start)} 〜 ${formatDate(range.end)}`
    : "未定";

  card.innerHTML = `
    <div class="card-header">
      <h3>${escapeHtml(item.company)}</h3>
      <span class="status-badge status-${escapeHtml(item.status)}"><span class="dot"></span>${escapeHtml(item.status)}</span>
    </div>
    <div class="card-body">
      <div class="row"><span class="label">業界</span><span>${escapeHtml(item.industry) || "未入力"}</span></div>
      <div class="row"><span class="label">内容</span><span>${escapeHtml(item.internshipType) || "未入力"}</span></div>
      <div class="row"><span class="label">応募締切</span><span>${formatDate(item.deadline)} <span class="deadline-pill ${pillClass}">${formatDaysLabel(days)}</span></span></div>
      <div class="row"><span class="label">説明会</span><span>${item.infoSessionDate ? formatDate(item.infoSessionDate) : "未定"}</span></div>
      <div class="row"><span class="label">面接日</span><span>${item.interviewDate ? formatDate(item.interviewDate) : "未定"}</span></div>
      ${item.internshipName ? `<div class="row"><span class="label">インターン名</span><span>${escapeHtml(item.internshipName)}</span></div>` : ""}
      <div class="row"><span class="label">参加期間</span><span>${rangeText}</span></div>
      ${item.memo ? `<div class="card-memo">${escapeHtml(item.memo)}</div>` : ""}
    </div>
    ${item.mypageUrl || item.mypageIdEnc || item.mypagePasswordEnc
      ? `<div class="card-mypage-actions">
          ${item.mypageUrl ? '<button class="btn mypage-open-btn">マイページへ移動</button>' : ""}
          ${item.mypageIdEnc ? '<button class="btn mypage-copy-id-btn">IDをコピー</button>' : ""}
          ${item.mypagePasswordEnc ? '<button class="btn mypage-copy-pw-btn">パスワードをコピー</button>' : ""}
        </div>`
      : ""}
    <div class="card-actions">
      <button class="btn edit-btn">編集</button>
      <button class="btn delete-btn">削除</button>
    </div>
  `;

  // 編集ボタンが押されたら、このデータをフォームに読み込む
  const editBtn = card.querySelector(".edit-btn");
  editBtn.addEventListener("click", () => startEdit(item.id));

  // 削除ボタンが押されたら、このデータを削除する
  const deleteBtn = card.querySelector(".delete-btn");
  deleteBtn.addEventListener("click", () => deleteInternship(item.id));

  // マイページへ移動(新しいタブで開く。URLはそのまま保存しているので暗号化の解除は不要)
  const openBtn = card.querySelector(".mypage-open-btn");
  if (openBtn) {
    openBtn.addEventListener("click", () => {
      window.open(item.mypageUrl, "_blank", "noopener,noreferrer");
    });
  }

  // IDをコピー(認証してから復号し、クリップボードにコピーする)
  const copyIdBtn = card.querySelector(".mypage-copy-id-btn");
  if (copyIdBtn) {
    copyIdBtn.addEventListener("click", async () => {
      try {
        const idText = await decryptMypageField(item.mypageIdEnc);
        const copied = await copyTextToClipboard(idText);
        if (copied) {
          showToast("IDをコピーしました");
        } else {
          // 自動コピーに失敗した場合の最終手段: ダイアログに表示し、手動でコピーしてもらう
          window.prompt("コピーできませんでした。下の内容を選択してコピーしてください", idText);
        }
      } catch (error) {
        showToast(error.message || "コピーに失敗しました");
      }
    });
  }

  // パスワードをコピー(認証してから復号し、クリップボードにコピーする)
  const copyPwBtn = card.querySelector(".mypage-copy-pw-btn");
  if (copyPwBtn) {
    copyPwBtn.addEventListener("click", async () => {
      try {
        const pwText = await decryptMypageField(item.mypagePasswordEnc);
        const copied = await copyTextToClipboard(pwText);
        if (copied) {
          showToast("パスワードをコピーしました");
        } else {
          window.prompt("コピーできませんでした。下の内容を選択してコピーしてください", pwText);
        }
      } catch (error) {
        showToast(error.message || "コピーに失敗しました");
      }
    });
  }

  return card;
}

// 日付(YYYY-MM-DD)を「YYYY年M月D日」の形に変換して見やすくする関数
function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

// HTMLとして解釈されると困る文字(< > など)を無害な文字に変換する関数
// これを行わないと、企業名やメモに <script> のような文字を入力されたときに
// 意図しないコードが実行されてしまう危険がある(XSS対策)
function escapeHtml(text) {
  if (text === undefined || text === null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ================================================
// 「一覧」「カレンダー」の表示切り替え(タブ)
// ================================================
viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    currentView = tab.dataset.view;

    viewTabs.forEach((t) => {
      const isActive = t === tab;
      t.classList.toggle("active", isActive);
      t.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    listViewEl.hidden = currentView !== "list";
    calendarViewEl.hidden = currentView !== "calendar";
  });
});

// ================================================
// カレンダー表示
// 応募締切・説明会・面接日・インターン参加日を月ごとのマス目の上に表示し、
// 締切が近い予定は目立つ色にする。
// ================================================

// 日付をキー(YYYY-MM-DD)にするためのヘルパー(文字列操作だけで済ませ、タイムゾーンのずれを避ける)
function toDateKey(year, month, day) {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

const CALENDAR_KIND_LABELS = {
  deadline: "締切",
  infoSession: "説明会",
  interview: "面接",
};

// 日付(YYYY-MM-DD文字列)ごとに、その日が締切/説明会/面接になっている案件・
// インターン参加期間中の日・自分で自由に登録した予定をまとめる(月表示/週表示の両方で共通利用)
function buildEventsByDate(items) {
  const eventsByDate = new Map();
  const addEvent = (dateKey, entry) => {
    if (!dateKey) return;
    if (!eventsByDate.has(dateKey)) eventsByDate.set(dateKey, []);
    eventsByDate.get(dateKey).push(entry);
  };

  items.forEach((item) => {
    addEvent(item.deadline, { type: "company", item, kind: "deadline" });
    if (item.infoSessionDate) addEvent(item.infoSessionDate, { type: "company", item, kind: "infoSession" });
    if (item.interviewDate) addEvent(item.interviewDate, { type: "company", item, kind: "interview" });

    // インターン参加期間は、開始日から終了日までの毎日にイベントを展開しておく
    const range = getInternshipRange(item);
    if (range) {
      const start = new Date(range.start);
      const end = new Date(range.end);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateKey = toDateKey(d.getFullYear(), d.getMonth(), d.getDate());
        addEvent(dateKey, {
          type: "internshipRange",
          item,
          isFirst: d.getTime() === start.getTime(),
          isLast: d.getTime() === end.getTime(),
        });
      }
    }
  });

  loadCustomEvents().forEach((event) => {
    addEvent(event.date, { type: "custom", event });
  });

  return eventsByDate;
}

// 1マス分のセルを作る共通処理(月表示/週表示の両方で使う)。
// columnIndexは週の中で何列目か(0=日曜, 6=土曜)。行の端かどうかで、
// インターン参加期間の帯を丸めるかどうかを判定するために使う。
function buildCalendarCell({ day, dateKey, inMonth, isToday, columnIndex, eventsByDate, maxVisible }) {
  const cellEl = document.createElement("div");
  cellEl.className = "calendar-cell";
  if (!inMonth) cellEl.classList.add("outside");
  if (isToday) cellEl.classList.add("today");

  const dayLabel = document.createElement("div");
  dayLabel.className = "calendar-day-number";
  dayLabel.textContent = day;
  cellEl.appendChild(dayLabel);

  const events = eventsByDate.get(dateKey) || [];
  const isRowStart = columnIndex === 0;
  const isRowEnd = columnIndex === 6;

  events.slice(0, maxVisible).forEach((entry) => {
    const chip = document.createElement("button");
    chip.type = "button";

    if (entry.type === "company") {
      const { item, kind } = entry;
      const days = kind === "deadline" ? getDaysUntil(item.deadline) : null;
      const isSoon = kind === "deadline" && days !== null && days <= 3;
      chip.className = `calendar-chip ${kind}` + (isSoon ? " soon" : "");
      chip.textContent = `${CALENDAR_KIND_LABELS[kind]} ${item.company}`;
      chip.title = `${item.company}(${CALENDAR_KIND_LABELS[kind]})`;
      chip.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation(); // セルの「予定を追加」判定に伝わらないようにする
        startEdit(item.id);
      });
    } else if (entry.type === "internshipRange") {
      const { item, isFirst, isLast } = entry;
      // 週の行の端では、期間が本当に続いていても一旦「区切り」として丸める
      // (行をまたいだ帯の連続表示は行わない、Googleカレンダー等でも一般的な簡略化)
      const roundLeft = isFirst || isRowStart;
      const roundRight = isLast || isRowEnd;
      let cornerClass = "";
      if (!roundLeft && !roundRight) cornerClass = "range-middle";
      else if (!roundLeft) cornerClass = "range-end";
      else if (!roundRight) cornerClass = "range-start";
      chip.className = `calendar-chip internshipRange ${cornerClass}`.trim();
      // 企業名を表示するのは、期間の本当の初日か、行が変わって帯が新しく始まる場所だけにする
      // (それ以外は色だけの帯にして「まだ続いている」ことを示す)
      chip.textContent = roundLeft ? `参加 ${item.company}` : "";
      chip.title = `${item.company}${item.internshipName ? `「${item.internshipName}」` : ""}のインターン参加期間`;
      chip.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        startEdit(item.id);
      });
    } else {
      const { event } = entry;
      chip.className = `calendar-chip custom-event custom-${event.category}`;
      chip.textContent = `${event.category} ${event.title}`;
      chip.title = `${event.title}(${event.category})`;
      chip.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        openEventModal({ event });
      });
    }

    cellEl.appendChild(chip);
  });
  if (events.length > maxVisible) {
    const more = document.createElement("div");
    more.className = "calendar-more";
    more.textContent = `+${events.length - maxVisible}件`;
    cellEl.appendChild(more);
  }

  // 空いている場所(予定チップ以外)をタップすると、その日付で新しい予定を追加できる
  cellEl.addEventListener("click", () => {
    openEventModal({ dateKey });
  });

  return cellEl;
}

function renderCalendar(items) {
  const eventsByDate = buildEventsByDate(items);
  const today = getToday();
  const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());

  calendarGrid.classList.toggle("week-mode", calendarViewMode === "week");

  if (calendarViewMode === "week") {
    renderCalendarWeek(eventsByDate, todayKey);
  } else {
    renderCalendarMonth(eventsByDate, todayKey);
  }
}

// ---- 月表示 ----
function renderCalendarMonth(eventsByDate, todayKey) {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth(); // 0始まり(0=1月)
  calendarMonthLabel.textContent = `${year}年${month + 1}月`;

  // その月を含む週の日曜日から、6週間分(42マス)のカレンダーを作る
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0=日曜
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  // 前月の余り日
  for (let i = 0; i < startWeekday; i++) {
    const day = daysInPrevMonth - startWeekday + 1 + i;
    const prevMonthDate = new Date(year, month - 1, day);
    cells.push({ day, dateKey: toDateKey(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), day), inMonth: false });
  }
  // 今月分
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, dateKey: toDateKey(year, month, day), inMonth: true });
  }
  // 翌月の余り日(常に6週間=42マスになるまで埋める。月によって行数が変わらないようにするため)
  const nextMonthDate = new Date(year, month + 1, 1);
  for (let day = 1; cells.length < 42; day++) {
    cells.push({
      day,
      dateKey: toDateKey(nextMonthDate.getFullYear(), nextMonthDate.getMonth(), day),
      inMonth: false,
    });
  }

  calendarGrid.innerHTML = "";
  cells.forEach((cell, index) => {
    const cellEl = buildCalendarCell({
      day: cell.day,
      dateKey: cell.dateKey,
      inMonth: cell.inMonth,
      isToday: cell.dateKey === todayKey,
      columnIndex: index % 7,
      eventsByDate,
      maxVisible: 2,
    });
    calendarGrid.appendChild(cellEl);
  });
}

// ---- 週表示 ----
function renderCalendarWeek(eventsByDate, todayKey) {
  const weekEnd = new Date(calendarWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const sameMonth = calendarWeekStart.getMonth() === weekEnd.getMonth();
  calendarMonthLabel.textContent = sameMonth
    ? `${calendarWeekStart.getFullYear()}年${calendarWeekStart.getMonth() + 1}月${calendarWeekStart.getDate()}日 〜 ${weekEnd.getDate()}日`
    : `${calendarWeekStart.getMonth() + 1}月${calendarWeekStart.getDate()}日 〜 ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;

  calendarGrid.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(calendarWeekStart);
    d.setDate(d.getDate() + i);
    const dateKey = toDateKey(d.getFullYear(), d.getMonth(), d.getDate());
    const cellEl = buildCalendarCell({
      day: d.getDate(),
      dateKey,
      inMonth: true,
      isToday: dateKey === todayKey,
      columnIndex: i,
      eventsByDate,
      maxVisible: 6,
    });
    calendarGrid.appendChild(cellEl);
  }
}

calPrevBtn.addEventListener("click", () => {
  if (calendarViewMode === "week") {
    calendarWeekStart = new Date(calendarWeekStart.getFullYear(), calendarWeekStart.getMonth(), calendarWeekStart.getDate() - 7);
  } else {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  }
  renderCalendar(lastFilteredItems);
});

calNextBtn.addEventListener("click", () => {
  if (calendarViewMode === "week") {
    calendarWeekStart = new Date(calendarWeekStart.getFullYear(), calendarWeekStart.getMonth(), calendarWeekStart.getDate() + 7);
  } else {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  }
  renderCalendar(lastFilteredItems);
});

// 月表示⇔週表示の切り替え
calendarModeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const newMode = btn.dataset.mode;
    if (newMode === calendarViewMode) return;
    calendarViewMode = newMode;

    calendarModeBtns.forEach((b) => {
      const isActive = b === btn;
      b.classList.toggle("active", isActive);
      b.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    const today = new Date();
    if (calendarViewMode === "week") {
      // 今表示している月が「今月」なら今日の週へ、そうでなければその月の最初の週へ移動する
      const isCurrentMonthShown =
        calendarMonth.getFullYear() === today.getFullYear() && calendarMonth.getMonth() === today.getMonth();
      calendarWeekStart = getWeekStart(isCurrentMonthShown ? today : new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1));
    } else {
      calendarMonth = new Date(calendarWeekStart.getFullYear(), calendarWeekStart.getMonth(), 1);
    }
    renderCalendar(lastFilteredItems);
  });
});

// ================================================
// カレンダーの自由な予定(面接・説明会・ES提出・大学の予定など)の追加・編集・削除
// 企業の応募データとは別に、それ専用のlocalStorageキーで管理する。
// ================================================

// 予定モーダルを開く。新規追加なら{dateKey}を、既存の予定を編集するなら{event}を渡す
function openEventModal({ event, dateKey } = {}) {
  eventForm.reset();
  if (event) {
    eventModalTitle.textContent = "予定を編集";
    eventIdInput.value = event.id;
    eventTitleInput.value = event.title;
    eventDateInput.value = event.date;
    eventCategoryInput.value = event.category;
    eventMemoInput.value = event.memo || "";
    eventDeleteBtn.hidden = false;
    document.getElementById("event-submit-btn").textContent = "更新する";
  } else {
    eventModalTitle.textContent = "予定を追加";
    eventIdInput.value = "";
    eventDateInput.value = dateKey || "";
    eventDeleteBtn.hidden = true;
    document.getElementById("event-submit-btn").textContent = "追加する";
  }
  eventModal.showModal();
  eventTitleInput.focus();
}

function closeEventModal() {
  eventModal.close();
}

eventCancelBtn.addEventListener("click", closeEventModal);
eventCloseBtn.addEventListener("click", closeEventModal);

eventForm.addEventListener("submit", (submitEvent) => {
  submitEvent.preventDefault();

  const events = loadCustomEvents();
  const formData = {
    title: eventTitleInput.value.trim(),
    date: eventDateInput.value,
    category: eventCategoryInput.value,
    memo: eventMemoInput.value.trim(),
  };

  if (eventIdInput.value) {
    const index = events.findIndex((e) => e.id === eventIdInput.value);
    if (index !== -1) events[index] = { id: eventIdInput.value, ...formData };
  } else {
    events.push({ id: Date.now().toString(), ...formData });
  }

  saveCustomEvents(events);
  renderCalendar(lastFilteredItems);
  closeEventModal();
});

eventDeleteBtn.addEventListener("click", () => {
  if (!confirm("この予定を削除しますか？")) return;
  const events = loadCustomEvents().filter((e) => e.id !== eventIdInput.value);
  saveCustomEvents(events);
  renderCalendar(lastFilteredItems);
  closeEventModal();
});

// ================================================
// マイページのID・パスワード欄の状態管理
// ================================================

// 今フォームで編集中のデータ(暗号化されたID・パスワードを持っている場合、復号のために参照する)
let currentEditingItem = null;

// ID・パスワード欄がユーザーの入力によって変更されたかどうか
// (「表示」ボタンによる復号表示では変更扱いにせず、実際にタイプ/削除したときだけtrueにする)
let mypageIdChanged = false;
let mypagePasswordChanged = false;
mypageIdInput.addEventListener("input", () => { mypageIdChanged = true; });
mypagePasswordInput.addEventListener("input", () => { mypagePasswordChanged = true; });

// ID・パスワード欄の表示状態("none"=新規入力中, "masked"=保存済みで伏字, "revealed"=復号して表示中)
let mypageRevealState = "none";

mypagePasswordToggleBtn.addEventListener("click", async () => {
  if (mypageRevealState === "masked") {
    // 保存済みのID・パスワードを復号して表示する(ここで生体認証/パスコードを求める)
    mypagePasswordToggleBtn.disabled = true;
    try {
      const idText = currentEditingItem?.mypageIdEnc ? await decryptMypageField(currentEditingItem.mypageIdEnc) : "";
      const pwText = currentEditingItem?.mypagePasswordEnc ? await decryptMypageField(currentEditingItem.mypagePasswordEnc) : "";
      mypageIdInput.value = idText;
      mypagePasswordInput.value = pwText;
      mypagePasswordInput.type = "text";
      mypageRevealState = "revealed";
      mypagePasswordToggleBtn.textContent = "隠す";
    } catch (error) {
      showToast(error.message || "表示に失敗しました");
    } finally {
      mypagePasswordToggleBtn.disabled = false;
    }
  } else if (mypageRevealState === "revealed") {
    // 値はそのまま保持し、見た目だけ伏字に戻す
    mypagePasswordInput.type = "password";
    mypagePasswordToggleBtn.textContent = "表示";
  } else {
    // 新規入力中: 今タイプした文字を見せるだけ(暗号化・認証とは無関係)
    const showing = mypagePasswordInput.type === "text";
    mypagePasswordInput.type = showing ? "password" : "text";
    mypagePasswordToggleBtn.textContent = showing ? "表示" : "隠す";
  }
});

// ================================================
// モーダル(追加・編集フォーム)の開閉
// ================================================
function openModalForAdd() {
  resetForm();
  formModal.showModal();
  companyInput.focus();
}

function closeModal() {
  formModal.close();
}

openAddBtn.addEventListener("click", openModalForAdd);
cancelBtn.addEventListener("click", closeModal);
closeModalBtn.addEventListener("click", closeModal);

// モーダルが閉じられたとき(キャンセル・ESCキーなど、どの方法でも)フォームをリセットする
formModal.addEventListener("close", resetForm);

// ================================================
// 追加・編集・削除の処理
// ================================================

// フォームが送信された(追加ボタン or 更新ボタンが押された)ときの処理
form.addEventListener("submit", async (event) => {
  // フォーム送信によるページの再読み込みを止める
  event.preventDefault();

  // 暗号化の認証待ちの間に、二重に送信されてしまわないようにする
  if (submitBtn.disabled) return;
  submitBtn.disabled = true;

  const internships = loadInternships();
  const targetId = editIdInput.value;
  const existingItem = targetId ? internships.find((item) => item.id === targetId) : null;

  // 暗号化には時間がかかることがある(生体認証やパスコード入力を待つため)。
  // その間にフォームの内容が変わっても影響を受けないよう、先に値をすべて読み取っておく
  const formData = {
    company: companyInput.value.trim(),
    industry: industryInput.value.trim(),
    internshipType: internshipTypeInput.value,
    deadline: deadlineInput.value,
    status: statusInput.value,
    infoSessionDate: infoSessionDateInput.value,
    interviewDate: interviewDateInput.value,
    internshipName: internshipNameInput.value.trim(),
    internshipStartDate: internshipStartDateInput.value,
    internshipEndDate: internshipEndDateInput.value,
    memo: memoInput.value.trim(),
    mypageUrl: mypageUrlInput.value.trim(),
    mypageIdEnc: existingItem ? existingItem.mypageIdEnc : null,
    mypagePasswordEnc: existingItem ? existingItem.mypagePasswordEnc : null,
  };
  const rawMypageId = mypageIdInput.value;
  const rawMypagePassword = mypagePasswordInput.value;

  // ID・パスワードは「実際に変更された時だけ」暗号化し直す。
  // 触っていなければ、既存の暗号化データをそのまま引き継ぐ(無駄な認証を求めないため)
  try {
    if (mypageIdChanged) {
      formData.mypageIdEnc = await encryptMypageField(rawMypageId);
    }
    if (mypagePasswordChanged) {
      formData.mypagePasswordEnc = await encryptMypageField(rawMypagePassword);
    }
  } catch (error) {
    showToast("マイページ情報の暗号化に失敗しました");
    submitBtn.disabled = false;
    return;
  }

  if (targetId) {
    // 隠しフィールドにIDが入っている = 編集モード
    const index = internships.findIndex((item) => item.id === targetId);
    if (index !== -1) {
      internships[index] = { id: targetId, ...formData };
    }
  } else {
    // IDが入っていない = 新規追加モード
    const newItem = {
      id: Date.now().toString(), // 現在時刻を使った簡易的なユニークID
      ...formData,
    };
    internships.push(newItem);
  }

  saveInternships(internships);
  renderAll();
  submitBtn.disabled = false;
  closeModal();
});

// 編集ボタンが押されたときに、そのデータをフォームに反映してモーダルを開く関数
function startEdit(id) {
  const internships = loadInternships();
  const item = internships.find((item) => item.id === id);
  if (!item) return;

  editIdInput.value = item.id;
  companyInput.value = item.company;
  industryInput.value = item.industry;
  internshipTypeInput.value = item.internshipType;
  deadlineInput.value = item.deadline;
  statusInput.value = item.status;
  infoSessionDateInput.value = item.infoSessionDate;
  interviewDateInput.value = item.interviewDate;
  internshipNameInput.value = item.internshipName || "";
  internshipStartDateInput.value = item.internshipStartDate || "";
  internshipEndDateInput.value = item.internshipEndDate || "";
  memoInput.value = item.memo;

  mypageUrlInput.value = item.mypageUrl || "";
  currentEditingItem = item;
  mypageIdChanged = false;
  mypagePasswordChanged = false;
  mypagePasswordInput.type = "password";
  const hasCredentials = Boolean(item.mypageIdEnc || item.mypagePasswordEnc);
  if (hasCredentials) {
    // 実際のID・パスワードはまだ復号しない。伏字を見せておき、「表示」ボタンで初めて認証・復号する
    mypageIdInput.value = "••••••••";
    mypagePasswordInput.value = "••••••••";
    mypageRevealState = "masked";
    mypageLockNote.textContent = "保存済み(表示ボタンで確認・変更できます)";
    mypagePasswordToggleBtn.textContent = "表示";
  } else {
    mypageIdInput.value = "";
    mypagePasswordInput.value = "";
    mypageRevealState = "none";
    mypageLockNote.textContent = "";
  }

  // フォームの見た目を「編集モード」に切り替える
  formTitle.textContent = "応募内容を編集";
  submitBtn.textContent = "更新する";

  formModal.showModal();
}

// 削除ボタンが押されたときの処理
function deleteInternship(id) {
  // 誤操作防止のため、削除前に確認する
  const isConfirmed = confirm("この応募情報を削除しますか？");
  if (!isConfirmed) return;

  const internships = loadInternships();
  const filtered = internships.filter((item) => item.id !== id);
  saveInternships(filtered);
  renderAll();
}

// フォームを空にして「新規追加モード」に戻す関数
function resetForm() {
  form.reset();
  editIdInput.value = "";
  statusInput.value = "未応募"; // 選考状況の初期値

  currentEditingItem = null;
  mypageIdChanged = false;
  mypagePasswordChanged = false;
  mypageRevealState = "none";
  mypageLockNote.textContent = "";
  mypagePasswordInput.type = "password";
  mypagePasswordToggleBtn.textContent = "表示";

  formTitle.textContent = "新しい応募を追加";
  submitBtn.textContent = "追加する";
}

// ================================================
// ページが開かれたときに最初に一覧を表示する
// ================================================
renderAll();

// ================================================
// サービスワーカーの登録(対応ブラウザのみ)
// これにより、スマホのホーム画面に追加してアプリのように使えるようになり、
// 一度開いたことがあれば電波が悪い場所でも起動できるようになる。
// ================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // オフライン用の登録に失敗しても、アプリ本体の動作には影響しないため何もしない
    });
  });
}
