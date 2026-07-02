// ================================================
// インターン応募管理アプリ本体
// データはブラウザの localStorage に保存する。
// localStorage は「文字列」しか保存できないので、
// 配列やオブジェクトは JSON.stringify / JSON.parse で変換して使う。
// ================================================

// localStorageに保存するときのキー名(自由な名前でOK)
const STORAGE_KEY = "internships";

// 選考状況の並び順(グラフの棒やセレクトボックスの並びをこの順番にそろえる)
const STATUS_ORDER = ["未応募", "応募済み", "書類選考中", "面接予定", "内定", "不合格", "辞退"];

// 選考状況ごとの色(グラフの棒の色。カードのバッジ色はCSS側で管理)
const STATUS_COLORS = {
  未応募: "#c3c2b7",
  応募済み: "#2a78d6",
  書類選考中: "#eda100",
  面接予定: "#4a3aa7",
  内定: "#0ca30c",
  不合格: "#d03b3b",
  辞退: "#898781",
};

// 現在選択されている業界フィルター("all"のときはすべて表示)
let currentIndustryFilter = "all";

// ---- HTMLの要素を先に取得しておく ----
const form = document.getElementById("internship-form");
const editIdInput = document.getElementById("edit-id");
const companyInput = document.getElementById("company");
const industryInput = document.getElementById("industry");
const industrySuggestions = document.getElementById("industry-suggestions");
const deadlineInput = document.getElementById("deadline");
const statusInput = document.getElementById("status");
const interviewDateInput = document.getElementById("interview-date");
const memoInput = document.getElementById("memo");

const formTitle = document.getElementById("form-title");
const submitBtn = document.getElementById("submit-btn");
const cancelBtn = document.getElementById("cancel-btn");
const closeModalBtn = document.getElementById("close-modal-btn");
const openAddBtn = document.getElementById("open-add-btn");
const formModal = document.getElementById("form-modal");

const industryFilterSelect = document.getElementById("industry-filter");

const statGrid = document.getElementById("stat-grid");
const chartWrap = document.getElementById("status-chart");
const chartTotal = document.getElementById("chart-total");
const chartTooltip = document.getElementById("chart-tooltip");

const listContainer = document.getElementById("internship-list");
const listCount = document.getElementById("list-count");
const emptyMessage = document.getElementById("empty-message");

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
  // 文字列(JSON)を配列(JavaScriptのデータ)に変換して返す
  return JSON.parse(jsonText);
}

// 配列を丸ごとlocalStorageに保存する関数
function saveInternships(internships) {
  // 配列を文字列(JSON)に変換して保存する
  localStorage.setItem(STORAGE_KEY, JSON.stringify(internships));
}

// ================================================
// 画面全体を再描画する入り口の関数
// フィルターの選択肢・ダッシュボード・グラフ・一覧は、
// すべてこの関数から呼び出して連動させる。
// ================================================
function renderAll() {
  const all = loadInternships();

  renderIndustryFilterOptions(all);
  renderIndustrySuggestions(all);

  const filtered = filterByIndustry(all, currentIndustryFilter);

  renderStatTiles(filtered);
  renderStatusChart(filtered);
  renderList(filtered);
}

// 業界フィルターの値に応じてデータを絞り込む関数
function filterByIndustry(internships, industry) {
  if (industry === "all") return internships;
  return internships.filter((item) => (item.industry || "未分類") === industry);
}

// ================================================
// 業界フィルター(セレクトボックス)の描画
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

// ================================================
// 締切までの残り日数を計算するための共通関数
// ================================================

// 今日の日付(時刻を0時0分にそろえて、日付だけで比較できるようにする)
function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

// 締切日と今日の差(日数)を計算する。マイナスなら締切を過ぎている
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

// ================================================
// ダッシュボード(統計タイル)の描画
// ================================================
function renderStatTiles(items) {
  const total = items.length;

  // ES(書類選考)通過率
  // 分子: 書類選考を通過して「面接予定」または「内定」まで進んだ件数
  // 分母: 書類選考の結果が出た件数(面接予定+内定+不合格)。まだ結果待ちの案件は含めない
  const esPassed = items.filter((i) => i.status === "面接予定" || i.status === "内定").length;
  const esDecided = items.filter((i) =>
    ["面接予定", "内定", "不合格"].includes(i.status)
  ).length;
  const esRate = esDecided === 0 ? null : Math.round((esPassed / esDecided) * 100);

  const offerCount = items.filter((i) => i.status === "内定").length;
  const inProgressCount = items.filter((i) =>
    ["書類選考中", "面接予定"].includes(i.status)
  ).length;

  // 直近の締切(まだ来ていない締切の中で、いちばん近いもの)
  const upcoming = items
    .filter((i) => getDaysUntil(i.deadline) !== null && getDaysUntil(i.deadline) >= 0)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))[0];

  const tiles = [
    {
      label: "総応募数",
      value: `${total}件`,
      caption: null,
    },
    {
      label: "選考中",
      value: `${inProgressCount}件`,
      caption: "書類選考中・面接予定の合計",
    },
    {
      label: "ES通過率",
      value: esRate === null ? "ー" : `${esRate}%`,
      caption: esDecided === 0 ? "結果が出た応募がまだありません" : `${esPassed}/${esDecided}件 通過`,
      help: "ES通過率 = (面接予定+内定) ÷ (面接予定+内定+不合格)",
    },
    {
      label: "内定",
      value: `${offerCount}件`,
      caption: null,
    },
    {
      label: "直近の締切",
      value: upcoming ? formatDaysLabel(getDaysUntil(upcoming.deadline)) : "ー",
      caption: upcoming ? upcoming.company : "予定されている締切はありません",
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
// 選考状況別の件数グラフ(SVGを使った自作の棒グラフ)
// ================================================
function renderStatusChart(items) {
  chartTotal.textContent = `合計 ${items.length}件`;

  // 選考状況ごとの件数を数える
  const counts = STATUS_ORDER.map((status) => ({
    status,
    count: items.filter((i) => i.status === status).length,
  }));

  if (items.length === 0) {
    chartWrap.innerHTML = '<p class="chart-empty">表示できるデータがありません</p>';
    return;
  }

  // ---- SVGのレイアウトを計算する ----
  const width = 700;
  const height = 220;
  const paddingLeft = 34;
  const paddingRight = 10;
  const paddingTop = 24;
  const paddingBottom = 34;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;
  const baselineY = paddingTop + plotHeight;

  const maxCount = Math.max(...counts.map((c) => c.count));
  // 目盛りの最大値をきりのいい数字にする(0件だけの場合でも1目盛り分の高さを確保する)
  const niceMax = maxCount === 0 ? 1 : maxCount;
  const midValue = Math.round(niceMax / 2);

  const slotWidth = plotWidth / counts.length;
  const barWidth = Math.min(24, slotWidth * 0.5);
  const radius = 4;

  // ---- 目盛り線(0 / 中間 / 最大)を描く。値が小さく中間目盛りが0や最大と重なる場合は省略する ----
  const gridValues = [0, midValue, niceMax].filter(
    (value, index, self) => self.indexOf(value) === index
  );
  const gridLinesSvg = gridValues
    .map((value) => {
      const y = baselineY - plotHeight * (value / niceMax);
      return `
        <line class="chart-gridline" x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}"></line>
        <text class="chart-axis-label" x="${paddingLeft - 8}" y="${y + 4}" text-anchor="end">${value}</text>
      `;
    })
    .join("");

  // ---- 棒グラフ本体を描く ----
  const barsSvg = counts
    .map((item, index) => {
      const slotX = paddingLeft + index * slotWidth;
      const barX = slotX + (slotWidth - barWidth) / 2;
      const barHeight = (item.count / niceMax) * plotHeight;
      const barY = baselineY - barHeight;
      const r = Math.min(radius, barWidth / 2, barHeight);

      // 棒の形(上だけ角丸、下は直角にする)。0件の場合は棒自体を描かない
      const path =
        barHeight > 0
          ? `M${barX},${baselineY}
             L${barX},${barY + r}
             Q${barX},${barY} ${barX + r},${barY}
             L${barX + barWidth - r},${barY}
             Q${barX + barWidth},${barY} ${barX + barWidth},${barY + r}
             L${barX + barWidth},${baselineY} Z`
          : "";

      const color = STATUS_COLORS[item.status] || "#c3c2b7";
      const labelX = slotX + slotWidth / 2;

      return `
        <g class="bar-group" tabindex="0" data-status="${escapeHtml(item.status)}" data-count="${item.count}">
          <!-- クリック/ホバー判定を広くするための透明な当たり判定エリア -->
          <rect class="bar-hit" x="${slotX}" y="${paddingTop}" width="${slotWidth}" height="${plotHeight}"></rect>
          ${path ? `<path class="bar-shape" d="${path}" fill="${color}"></path>` : ""}
          <text class="chart-value-label" x="${labelX}" y="${barY - 6}" text-anchor="middle">${item.count}</text>
          <text class="chart-axis-label" x="${labelX}" y="${baselineY + 16}" text-anchor="middle">${escapeHtml(item.status)}</text>
        </g>
      `;
    })
    .join("");

  chartWrap.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="選考状況別の件数グラフ">
      <line class="chart-baseline" x1="${paddingLeft}" y1="${baselineY}" x2="${width - paddingRight}" y2="${baselineY}"></line>
      ${gridLinesSvg}
      ${barsSvg}
    </svg>
  `;

  // ---- 棒にカーソルを合わせた/フォーカスした時にツールチップを出す ----
  chartWrap.querySelectorAll(".bar-group").forEach((group) => {
    const show = (event) => {
      const status = group.dataset.status;
      const count = group.dataset.count;
      chartTooltip.innerHTML = "";
      const strong = document.createElement("strong");
      strong.textContent = `${count}件`;
      chartTooltip.appendChild(strong);
      chartTooltip.appendChild(document.createTextNode(` ${status}`));
      chartTooltip.hidden = false;

      const point = "clientX" in event ? event : group.getBoundingClientRect();
      const x = "clientX" in event ? event.clientX : point.left + point.width / 2;
      const y = "clientY" in event ? event.clientY : point.top;
      chartTooltip.style.left = `${x}px`;
      chartTooltip.style.top = `${y}px`;
    };
    const hide = () => {
      chartTooltip.hidden = true;
    };

    group.addEventListener("pointermove", show);
    group.addEventListener("pointerenter", show);
    group.addEventListener("pointerleave", hide);
    group.addEventListener("focus", show);
    group.addEventListener("blur", hide);
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
      <div class="row"><span class="label">応募締切</span><span>${formatDate(item.deadline)} <span class="deadline-pill ${pillClass}">${formatDaysLabel(days)}</span></span></div>
      <div class="row"><span class="label">面接日</span><span>${item.interviewDate ? formatDate(item.interviewDate) : "未定"}</span></div>
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
    deadline: deadlineInput.value,
    status: statusInput.value,
    interviewDate: interviewDateInput.value,
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
  deadlineInput.value = item.deadline;
  statusInput.value = item.status;
  interviewDateInput.value = item.interviewDate;
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
