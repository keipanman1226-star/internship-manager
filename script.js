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

  return {
    ...item,
    status,
    internshipType,
    infoSessionDate: item.infoSessionDate || "",
    internshipDate: item.internshipDate || "",
  };
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
const internshipDateInput = document.getElementById("internship-date");
const memoInput = document.getElementById("memo");

const formTitle = document.getElementById("form-title");
const submitBtn = document.getElementById("submit-btn");
const cancelBtn = document.getElementById("cancel-btn");
const closeModalBtn = document.getElementById("close-modal-btn");
const openAddBtn = document.getElementById("open-add-btn");
const formModal = document.getElementById("form-modal");

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
// ①今週の予定(ES締切・説明会・面接・インターン参加を日付順にまとめて表示)
// ================================================
const AGENDA_KIND_LABELS = {
  deadline: "ES締切",
  infoSession: "説明会",
  interview: "面接",
  internshipDate: "インターン参加",
};
const AGENDA_KIND_COLORS = {
  deadline: "#4a3aa7",
  infoSession: "#1baf7a",
  interview: "#2a78d6",
  internshipDate: "#eb6834",
};

function renderAgenda(items) {
  const entries = [];
  items.forEach((item) => {
    [
      ["deadline", item.deadline],
      ["infoSession", item.infoSessionDate],
      ["interview", item.interviewDate],
      ["internshipDate", item.internshipDate],
    ].forEach(([kind, dateString]) => {
      const days = getDaysUntil(dateString);
      if (days !== null && days >= 0 && days <= 7) {
        entries.push({ kind, dateString, days, item });
      }
    });
  });

  entries.sort((a, b) => new Date(a.dateString) - new Date(b.dateString));

  agendaList.innerHTML = "";

  if (entries.length === 0) {
    agendaList.innerHTML = '<p class="dashboard-empty">今週の予定はありません</p>';
    return;
  }

  entries.forEach(({ kind, days, item }) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "agenda-row";

    const dayBadge = document.createElement("span");
    dayBadge.className = `agenda-day-badge ${urgencyClass(days)}`;
    dayBadge.textContent = formatDaysLabel(days);

    const kindBadge = document.createElement("span");
    kindBadge.className = "agenda-kind-badge";
    kindBadge.style.color = AGENDA_KIND_COLORS[kind];
    kindBadge.textContent = AGENDA_KIND_LABELS[kind];

    const companyLabel = document.createElement("span");
    companyLabel.className = "agenda-company";
    companyLabel.textContent = item.company;

    row.appendChild(dayBadge);
    row.appendChild(kindBadge);
    row.appendChild(companyLabel);
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
      <div class="row"><span class="label">参加日</span><span>${item.internshipDate ? formatDate(item.internshipDate) : "未定"}</span></div>
      ${item.memo ? `<div class="card-memo">${escapeHtml(item.memo)}</div>` : ""}
    </div>
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
  internshipDate: "参加",
};

function renderCalendar(items) {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth(); // 0始まり(0=1月)

  calendarMonthLabel.textContent = `${year}年${month + 1}月`;

  // 日付(YYYY-MM-DD文字列)ごとに、その日が締切/説明会/面接/参加日になっている案件をまとめておく
  const eventsByDate = new Map();
  const addEvent = (dateKey, item, kind) => {
    if (!dateKey) return;
    if (!eventsByDate.has(dateKey)) eventsByDate.set(dateKey, []);
    eventsByDate.get(dateKey).push({ item, kind });
  };
  items.forEach((item) => {
    addEvent(item.deadline, item, "deadline");
    if (item.infoSessionDate) addEvent(item.infoSessionDate, item, "infoSession");
    if (item.interviewDate) addEvent(item.interviewDate, item, "interview");
    if (item.internshipDate) addEvent(item.internshipDate, item, "internshipDate");
  });

  // その月を含む週の日曜日から、6週間分(42マス)のカレンダーを作る
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0=日曜
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const todayKey = toDateKey(getToday().getFullYear(), getToday().getMonth(), getToday().getDate());

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
  cells.forEach((cell) => {
    const cellEl = document.createElement("div");
    cellEl.className = "calendar-cell";
    if (!cell.inMonth) cellEl.classList.add("outside");
    if (cell.dateKey === todayKey) cellEl.classList.add("today");

    const dayLabel = document.createElement("div");
    dayLabel.className = "calendar-day-number";
    dayLabel.textContent = cell.day;
    cellEl.appendChild(dayLabel);

    const events = eventsByDate.get(cell.dateKey) || [];
    const maxVisible = 2;
    events.slice(0, maxVisible).forEach(({ item, kind }) => {
      const chip = document.createElement("button");
      chip.type = "button";
      const days = kind === "deadline" ? getDaysUntil(item.deadline) : null;
      const isSoon = kind === "deadline" && days !== null && days <= 3;
      chip.className = `calendar-chip ${kind}` + (isSoon ? " soon" : "");
      chip.textContent = `${CALENDAR_KIND_LABELS[kind]} ${item.company}`;
      chip.title = `${item.company}(${CALENDAR_KIND_LABELS[kind]})`;
      chip.addEventListener("click", () => startEdit(item.id));
      cellEl.appendChild(chip);
    });
    if (events.length > maxVisible) {
      const more = document.createElement("div");
      more.className = "calendar-more";
      more.textContent = `+${events.length - maxVisible}件`;
      cellEl.appendChild(more);
    }

    calendarGrid.appendChild(cellEl);
  });
}

calPrevBtn.addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  renderCalendar(lastFilteredItems);
});

calNextBtn.addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  renderCalendar(lastFilteredItems);
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
form.addEventListener("submit", (event) => {
  // フォーム送信によるページの再読み込みを止める
  event.preventDefault();

  const internships = loadInternships();

  // フォームの内容をまとめる
  const formData = {
    company: companyInput.value.trim(),
    industry: industryInput.value.trim(),
    internshipType: internshipTypeInput.value,
    deadline: deadlineInput.value,
    status: statusInput.value,
    infoSessionDate: infoSessionDateInput.value,
    interviewDate: interviewDateInput.value,
    internshipDate: internshipDateInput.value,
    memo: memoInput.value.trim(),
  };

  if (editIdInput.value) {
    // 隠しフィールドにIDが入っている = 編集モード
    const targetId = editIdInput.value;
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
  internshipDateInput.value = item.internshipDate;
  memoInput.value = item.memo;

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
