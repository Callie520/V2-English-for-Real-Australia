/*
 * 主脚本文件：负责移动端导航、动态生成学习卡片、收藏功能、
 * 艾宾浩斯复习系统、复习中心和搜索功能等。
 * 所有交互均通过浏览器的 localStorage 保存状态，刷新后数据不丢失。
 */

// 初始化导航菜单的展开/收起
function initNavigation() {
  const menuToggle = document.querySelector('.menu-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('show-menu');
    });
  }
}

// 调试功能已移除：不再在页面上插入调试信息。

// 本地存储的键
const STORAGE_KEYS = {
  favorites: 'efra_favorites',
  reviews: 'efra_reviews'
};

// Storage key for difficult items
const DIFFICULT_KEY = 'efra_difficult';

// ----- Daily plan settings and tasks -----
// Users can define how many new items to learn per category each day. The plan consists of
// categories: childcare, nursing, australian (life), and vocabulary. These values are
// stored in localStorage under PLAN_SETTINGS_KEY. A separate plan task object stores
// today's queued items and progress under PLAN_TASK_KEY.

const PLAN_SETTINGS_KEY = 'efra_planSettings';
const PLAN_TASK_KEY = 'efra_planTasks';

/**
 * Load daily plan settings from localStorage. If not present, return default settings.
 * @returns {{childcare:number, nursing:number, australian:number, vocab:number}}
 */
function loadPlanSettings() {
  try {
    const obj = JSON.parse(localStorage.getItem(PLAN_SETTINGS_KEY) || '{}');
    return {
      childcare: typeof obj.childcare === 'number' ? obj.childcare : 5,
      nursing: typeof obj.nursing === 'number' ? obj.nursing : 5,
      australian: typeof obj.australian === 'number' ? obj.australian : 5,
      vocab: typeof obj.vocab === 'number' ? obj.vocab : 10
    };
  } catch (e) {
    return { childcare: 5, nursing: 5, australian: 5, vocab: 10 };
  }
}

/**
 * Save daily plan settings to localStorage.
 * @param {{childcare:number, nursing:number, australian:number, vocab:number}} settings
 */
function savePlanSettings(settings) {
  localStorage.setItem(PLAN_SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Load today's plan tasks from localStorage.
 * @returns {object} the task object or an empty object
 */
function loadPlanTasks() {
  try {
    const t = JSON.parse(localStorage.getItem(PLAN_TASK_KEY) || '{}');
    return t || {};
  } catch (e) {
    return {};
  }
}

/** Save plan tasks to localStorage */
function savePlanTasks(tasks) {
  localStorage.setItem(PLAN_TASK_KEY, JSON.stringify(tasks));
}

/**
 * Generate today's plan tasks if they are missing or outdated. The plan includes
 * items by category in a fixed order: childcare, nursing, australian, vocab. For each
 * category, the list contains due review items followed by new items selected
 * from the available pool (items without review records). When existing tasks
 * match today's date and settings, they are reused.
 * @returns {object} the generated task object
 */
function generatePlanTasks() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  let tasks = loadPlanTasks();
  const settings = loadPlanSettings();
  // determine if tasks need regeneration
  if (tasks && tasks.date === todayStr && tasks.plan) {
    // Verify that each category's target matches the current plan settings. If not, regenerate.
    let match = true;
    for (const cat of ['childcare','nursing','australian','vocab']) {
      const seg = tasks.plan[cat];
      const expected = settings[cat];
      // If the saved target does not equal the expected target, regenerate
      if (!seg || seg.target !== expected) {
        match = false;
        break;
      }
    }
    if (match) {
      return tasks;
    }
  }
  // prepare items
  prepareAllItems();
  const reviews = loadReviews();
  const reviewKeys = Object.keys(reviews);
  // compute due review items by category
  const dueByCat = { childcare: [], nursing: [], australian: [], vocab: [] };
  const todayTime = today.getTime();
  reviewKeys.forEach(id => {
    const rec = reviews[id];
    if (!rec) return;
    if (rec.stage >= reviewSchedule.length) return; // mastered
    if (rec.nextReview <= todayTime) {
      const item = itemsMap[id];
      if (item && dueByCat[item.category]) {
        dueByCat[item.category].push(id);
      }
    }
  });
  // compute new items by category: items without review record
  const newByCat = { childcare: [], nursing: [], australian: [], vocab: [] };
  allItems.forEach(it => {
    if (!reviews[it.id] && newByCat[it.category]) {
      newByCat[it.category].push(it.id);
    }
  });
  // Do not shuffle new items within each category. We maintain the original order to provide a consistent learning path.
  // Build tasks.plan
  const plan = {};
  for (const cat of ['childcare','nursing','australian','vocab']) {
    const dueList = dueByCat[cat] || [];
    const targetCount = settings[cat] || 0;
    // Determine number of new items needed (target minus due count; allow due items beyond target)
    let needed = targetCount - dueList.length;
    if (needed < 0) needed = 0;
    const newList = newByCat[cat] ? newByCat[cat].slice(0, needed) : [];
    const list = dueList.concat(newList);
    // Save the target count separately; not the list length. This ensures regeneration when settings change.
    plan[cat] = { target: targetCount, list: list, completed: 0 };
  }
  tasks = {
    date: todayStr,
    plan,
    completed: false
  };
  savePlanTasks(tasks);
  return tasks;
}

/**
 * Update the plan progress display on the home page. Called on load and after progress changes.
 */
function updatePlanUI() {
  const elChild = document.getElementById('plan-childcare-progress');
  if (!elChild) return;
  const tasks = generatePlanTasks();
  const plan = tasks.plan || {};
  function setProgress(id, seg) {
    const el = document.getElementById(id);
    if (el) {
      const total = seg ? seg.list.length : 0;
      const done = seg ? seg.completed : 0;
      el.textContent = done + ' / ' + total;
    }
  }
  setProgress('plan-childcare-progress', plan.childcare);
  setProgress('plan-nursing-progress', plan.nursing);
  setProgress('plan-australian-progress', plan.australian);
  setProgress('plan-vocab-progress', plan.vocab);
}

/**
 * Compute and update learning statistics on the home page. It uses review records to count
 * learned, review and mastered items, and reads streak from daily info.
 */
function updateStatsUI() {
  const learnedEl = document.getElementById('stat-learned');
  if (!learnedEl) return;
  prepareAllItems();
  const reviews = loadReviews();
  let learned = 0;
  let reviewCount = 0;
  let mastered = 0;
  Object.keys(reviews).forEach(id => {
    const rec = reviews[id];
    learned++;
    if (rec.stage >= reviewSchedule.length) {
      mastered++;
    } else {
      reviewCount++;
    }
  });
  learnedEl.textContent = learned;
  const reviewEl = document.getElementById('stat-review');
  if (reviewEl) reviewEl.textContent = reviewCount;
  const masteredEl = document.getElementById('stat-mastered');
  if (masteredEl) masteredEl.textContent = mastered;
  const info = loadDailyInfo();
  const streakEl = document.getElementById('stat-streak');
  const streakVal = info.streak || 0;
  if (streakEl) streakEl.textContent = streakVal;
  // Update streak milestone icons: add active class if streak meets or exceeds milestone
  const icons = document.querySelectorAll('.streak-icon');
  icons.forEach(icon => {
    const required = parseInt(icon.dataset.days, 10);
    if (!isNaN(required) && streakVal >= required) {
      icon.classList.add('active');
    } else {
      icon.classList.remove('active');
    }
  });
}

/**
 * Increment progress for a specific category in today's plan. When all tasks are completed,
 * mark the plan as completed and update streak.
 * @param {string} cat The category to increment
 */
function incrementPlanProgress(cat) {
  let tasks = generatePlanTasks();
  if (!tasks.plan || !tasks.plan[cat]) return;
  const seg = tasks.plan[cat];
  if (typeof seg.completed !== 'number') seg.completed = 0;
  seg.completed++;
  // Save updated tasks
  savePlanTasks(tasks);
  updatePlanUI();
  updateStatsUI();
  // Check if all categories are done
  let allDone = true;
  for (const key of Object.keys(tasks.plan)) {
    const s = tasks.plan[key];
    if (s.completed < s.list.length) {
      allDone = false;
      break;
    }
  }
  tasks.completed = allDone;
  savePlanTasks(tasks);
  if (allDone) {
    // update streak and last completion date
    const info = loadDailyInfo();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    if (info.lastCompletionDate === yesterdayStr) {
      info.streak = (info.streak || 0) + 1;
    } else {
      info.streak = 1;
    }
    info.lastCompletionDate = todayStr;
    saveDailyInfo(info);
    updateStatsUI();
  }
}

/**
 * Load difficult item ids from localStorage.
 * @returns {string[]} array of ids
 */
function loadDifficult() {
  try {
    const arr = JSON.parse(localStorage.getItem(DIFFICULT_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    return [];
  }
}

/**
 * Save difficult ids to localStorage.
 * @param {string[]} ids
 */
function saveDifficult(ids) {
  localStorage.setItem(DIFFICULT_KEY, JSON.stringify(ids));
}

/**
 * Determine if an item id is marked as difficult.
 * @param {string} id
 */
function isDifficult(id) {
  return loadDifficult().includes(id);
}

/**
 * Toggle difficult status for an item.
 * @param {string} id
 */
function toggleDifficult(id) {
  let list = loadDifficult();
  if (list.includes(id)) {
    list = list.filter(d => d !== id);
  } else {
    list.push(id);
  }
  saveDifficult(list);
}

// 日常任务与语音存储键
const DAILY_INFO_KEY = 'efra_dailyInfo';
const DAILY_TASK_KEY = 'efra_dailyTasks';

// 语音相关变量
let availableVoices = [];
// 保存的语音选项（au, uk, us），默认从 localStorage 读取
let selectedVoiceCode = (typeof localStorage !== 'undefined' && localStorage.getItem('efra_voice')) || 'au';
let selectedVoice = null;

/**
 * 更新语音列表并选择合适的语音
 */
function updateVoiceList() {
  if (!('speechSynthesis' in window)) return;
  availableVoices = window.speechSynthesis.getVoices();
  updateSelectedVoice();
}

/**
 * 根据选中的语音代码选择具体语音对象
 */
function updateSelectedVoice() {
  if (!availableVoices || availableVoices.length === 0) {
    selectedVoice = null;
    return;
  }
  // 根据 selectedVoiceCode 查找匹配的语音
  const code = selectedVoiceCode;
  let match = null;
  function matchVoice(test) {
    return availableVoices.find(v => test(v));
  }
  if (code === 'au') {
    match = matchVoice(v => v.lang && v.lang.toLowerCase().includes('en-au')) || matchVoice(v => v.name && v.name.toLowerCase().includes('australian'));
  } else if (code === 'uk') {
    match = matchVoice(v => v.lang && v.lang.toLowerCase().includes('en-gb')) || matchVoice(v => v.name && v.name.toLowerCase().includes('british'));
  } else if (code === 'us') {
    match = matchVoice(v => v.lang && v.lang.toLowerCase().includes('en-us')) || matchVoice(v => v.name && v.name.toLowerCase().includes('american'));
  }
  // 如果未匹配到，则选择任何英语语音
  if (!match) {
    match = matchVoice(v => v.lang && v.lang.toLowerCase().startsWith('en'));
  }
  selectedVoice = match || null;
}

/**
 * 发音函数：使用浏览器 SpeechSynthesis 播放文本
 * @param {string} text 要朗读的文本
 */
function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  const utter = new SpeechSynthesisUtterance(text);
  if (selectedVoice) {
    utter.voice = selectedVoice;
    utter.lang = selectedVoice.lang;
  }
  utter.rate = 1;
  window.speechSynthesis.speak(utter);
}

/*
 * 数据备份：由于在本地 file:// 环境下外部 data.js 可能无法正常加载，
 * 我们在此提供数据的降级定义。当发现 window.childcareData 等未定义时，
 * 将使用下面的数组初始化。这样即使 data.js 未被执行，网站功能仍然可用。
 */
if (typeof window !== 'undefined') {
  // 幼儿园英语（Childcare English）
  if (!window.childcareData) {
    window.childcareData = [
      // 早晨送园
      { id: 'cc-1', english: 'Good morning!', chinese: '早上好！', scenario: '早晨送园' },
      { id: 'cc-2', english: 'Did she have breakfast?', chinese: '她吃早饭了吗？', scenario: '早晨送园' },
      { id: 'cc-3', english: 'Any special instructions for today?', chinese: '今天有什么特别需要注意的吗？', scenario: '早晨送园' },
      { id: 'cc-4', english: 'Is she bringing her lunch?', chinese: '她带午饭了吗？', scenario: '早晨送园' },
      { id: 'cc-5', english: 'Please sign her in.', chinese: '请帮她签到。', scenario: '早晨送园' },
      { id: 'cc-6', english: "She's a bit shy today.", chinese: '她今天有点害羞。', scenario: '早晨送园' },
      { id: 'cc-7', english: 'Let me know if she needs anything.', chinese: '如果她需要任何帮助，请告诉我。', scenario: '早晨送园' },
      { id: 'cc-8', english: "She has a doctor's appointment later.", chinese: '她稍后要去看医生。', scenario: '早晨送园' },
      { id: 'cc-9', english: 'She might be tired from the trip.', chinese: '她可能因为路途而有点累。', scenario: '早晨送园' },
      { id: 'cc-10', english: 'She needs her medication at noon.', chinese: '她中午需要服药。', scenario: '早晨送园' },
      { id: 'cc-11', english: 'Here is her water bottle.', chinese: '这是她的水壶。', scenario: '早晨送园' },
      { id: 'cc-12', english: 'Thanks for looking after her.', chinese: '谢谢照顾她。', scenario: '早晨送园' },
      // 下午接孩子
      { id: 'cc-13', english: 'How was her day?', chinese: '她今天过得怎么样？', scenario: '下午接孩子' },
      { id: 'cc-14', english: 'Did she eat well today?', chinese: '她今天吃得好吗？', scenario: '下午接孩子' },
      { id: 'cc-15', english: 'Did she have a nap?', chinese: '她午睡了吗？', scenario: '下午接孩子' },
      { id: 'cc-16', english: 'Did she play nicely with others?', chinese: '她和其他孩子玩得好吗？', scenario: '下午接孩子' },
      { id: 'cc-17', english: 'Did she have any accidents?', chinese: '她有发生什么意外吗？', scenario: '下午接孩子' },
      { id: 'cc-18', english: 'Does she have any artwork or crafts to take home?', chinese: '有作品带回家吗？', scenario: '下午接孩子' },
      { id: 'cc-19', english: 'Is there anything we need to work on?', chinese: '有没有需要我们配合的事情？', scenario: '下午接孩子' },
      { id: 'cc-20', english: 'When is the next event?', chinese: '下一次活动是什么时候？', scenario: '下午接孩子' },
      { id: 'cc-21', english: 'Did she drink enough water?', chinese: '她喝了足够的水吗？', scenario: '下午接孩子' },
      { id: 'cc-22', english: 'Any notes for tomorrow?', chinese: '明天有注意事项吗？', scenario: '下午接孩子' },
      { id: 'cc-23', english: 'How was her mood?', chinese: '她的心情怎么样？', scenario: '下午接孩子' },
      { id: 'cc-24', english: 'Thank you, see you tomorrow!', chinese: '谢谢，明天见！', scenario: '下午接孩子' },
      // 饮食沟通
      { id: 'cc-25', english: 'Did she finish her lunch?', chinese: '她把午饭吃完了吗？', scenario: '与老师沟通饮食' },
      { id: 'cc-26', english: "She doesn't like carrots.", chinese: '她不喜欢吃胡萝卜。', scenario: '与老师沟通饮食' },
      { id: 'cc-27', english: 'Could you give her more fruit?', chinese: '能给她多一些水果吗？', scenario: '与老师沟通饮食' },
      { id: 'cc-28', english: 'She is allergic to peanuts.', chinese: '她对花生过敏。', scenario: '与老师沟通饮食' },
      { id: 'cc-29', english: 'Please avoid dairy products.', chinese: '请避免乳制品。', scenario: '与老师沟通饮食' },
      { id: 'cc-30', english: 'She prefers rice over pasta.', chinese: '她比起面食更喜欢米饭。', scenario: '与老师沟通饮食' },
      { id: 'cc-31', english: 'She needs to drink more water.', chinese: '她需要多喝水。', scenario: '与老师沟通饮食' },
      { id: 'cc-32', english: 'Did she try any new foods today?', chinese: '她今天尝试了什么新食物吗？', scenario: '与老师沟通饮食' },
      { id: 'cc-33', english: 'She might be picky today.', chinese: '她今天可能挑食。', scenario: '与老师沟通饮食' },
      { id: 'cc-34', english: 'We packed a snack for her.', chinese: '我们给她准备了零食。', scenario: '与老师沟通饮食' },
      { id: 'cc-35', english: 'Please encourage her to eat vegetables.', chinese: '请鼓励她吃蔬菜。', scenario: '与老师沟通饮食' },
      { id: 'cc-36', english: 'She has a small appetite.', chinese: '她食量不大。', scenario: '与老师沟通饮食' },
      // 睡眠沟通
      { id: 'cc-37', english: 'Did she take a nap?', chinese: '她睡午觉了吗？', scenario: '与老师沟通睡眠' },
      { id: 'cc-38', english: 'How long did she sleep?', chinese: '她睡了多久？', scenario: '与老师沟通睡眠' },
      { id: 'cc-39', english: 'Was she hard to settle?', chinese: '她很难安静下来吗？', scenario: '与老师沟通睡眠' },
      { id: 'cc-40', english: 'She woke up crying.', chinese: '她醒来时哭了。', scenario: '与老师沟通睡眠' },
      { id: 'cc-41', english: 'She had a good nap today.', chinese: '她今天午睡得很好。', scenario: '与老师沟通睡眠' },
      { id: 'cc-42', english: "She didn't nap today.", chinese: '她今天没有午睡。', scenario: '与老师沟通睡眠' },
      { id: 'cc-43', english: 'She fell asleep quickly.', chinese: '她很快就睡着了。', scenario: '与老师沟通睡眠' },
      { id: 'cc-44', english: 'She had a short rest.', chinese: '她休息了一会儿。', scenario: '与老师沟通睡眠' },
      { id: 'cc-45', english: 'Please let her sleep longer if possible.', chinese: '如果可以，请让她多睡一会儿。', scenario: '与老师沟通睡眠' },
      { id: 'cc-46', english: 'We stayed up late last night.', chinese: '我们昨晚睡得晚。', scenario: '与老师沟通睡眠' },
      { id: 'cc-47', english: 'She uses a comforter to sleep.', chinese: '她睡觉需要抱一个玩具。', scenario: '与老师沟通睡眠' },
      { id: 'cc-48', english: "She didn't want to nap today.", chinese: '她今天不想睡午觉。', scenario: '与老师沟通睡眠' },
      // 生病沟通
      { id: 'cc-49', english: 'She has a fever today.', chinese: '她今天发烧了。', scenario: '与老师沟通生病' },
      { id: 'cc-50', english: 'She has a runny nose.', chinese: '她流鼻涕。', scenario: '与老师沟通生病' },
      { id: 'cc-51', english: 'She was coughing this morning.', chinese: '她今天早上咳嗽。', scenario: '与老师沟通生病' },
      { id: 'cc-52', english: 'She feels better now.', chinese: '她现在感觉好多了。', scenario: '与老师沟通生病' },
      { id: 'cc-53', english: 'Please monitor her temperature.', chinese: '请监测她的体温。', scenario: '与老师沟通生病' },
      { id: 'cc-54', english: 'She vomited once.', chinese: '她呕吐过一次。', scenario: '与老师沟通生病' },
      { id: 'cc-55', english: 'She is on antibiotics.', chinese: '她在服用抗生素。', scenario: '与老师沟通生病' },
      { id: 'cc-56', english: 'Please call me if she gets worse.', chinese: '如果她病情加重请打电话给我。', scenario: '与老师沟通生病' },
      { id: 'cc-57', english: 'She might be contagious.', chinese: '她可能会传染。', scenario: '与老师沟通生病' },
      { id: 'cc-58', english: 'She has an upset stomach.', chinese: '她肚子不舒服。', scenario: '与老师沟通生病' },
      { id: 'cc-59', english: 'She scratched herself.', chinese: '她抓伤了自己。', scenario: '与老师沟通生病' },
      { id: 'cc-60', english: 'She has been feeling tired.', chinese: '她感到疲倦。', scenario: '与老师沟通生病' },
      // 请假
      { id: 'cc-61', english: 'She will be absent tomorrow.', chinese: '她明天不会来。', scenario: '请假' },
      { id: 'cc-62', english: 'We are going on a holiday next week.', chinese: '我们下周去度假。', scenario: '请假' },
      { id: 'cc-63', english: 'She will be late today.', chinese: '她今天会迟到。', scenario: '请假' },
      { id: 'cc-64', english: 'We need to pick her up early.', chinese: '我们需要提前接她。', scenario: '请假' },
      { id: 'cc-65', english: 'She will return on Monday.', chinese: '她周一回来。', scenario: '请假' },
      { id: 'cc-66', english: 'Please excuse her absence.', chinese: '请批准她的请假。', scenario: '请假' },
      { id: 'cc-67', english: "We have a doctor's appointment.", chinese: '我们要去看医生。', scenario: '请假' },
      { id: 'cc-68', english: 'She has family visiting.', chinese: '有家人来访。', scenario: '请假' },
      { id: 'cc-69', english: 'She is not feeling well, so she will stay at home.', chinese: '她不舒服，所以会在家。', scenario: '请假' },
      { id: 'cc-70', english: 'We will travel overseas.', chinese: '我们要去国外。', scenario: '请假' },
      { id: 'cc-71', english: 'She will miss the event.', chinese: '她将错过这次活动。', scenario: '请假' },
      { id: 'cc-72', english: 'Please record her leave.', chinese: '请记录她的请假。', scenario: '请假' },
      // 询问孩子表现
      { id: 'cc-73', english: 'Did she participate in class?', chinese: '她有参加课堂活动吗？', scenario: '询问孩子表现' },
      { id: 'cc-74', english: 'Did she listen well?', chinese: '她有认真听讲吗？', scenario: '询问孩子表现' },
      { id: 'cc-75', english: 'She was very helpful today.', chinese: '她今天很乐于助人。', scenario: '询问孩子表现' },
      { id: 'cc-76', english: 'She shared her toys.', chinese: '她分享了自己的玩具。', scenario: '询问孩子表现' },
      { id: 'cc-77', english: 'She followed instructions.', chinese: '她遵循了指令。', scenario: '询问孩子表现' },
      { id: 'cc-78', english: 'She needed some help with tasks.', chinese: '她需要一些帮助。', scenario: '询问孩子表现' },
      { id: 'cc-79', english: 'She seemed upset.', chinese: '她看起来有些沮丧。', scenario: '询问孩子表现' },
      { id: 'cc-80', english: 'She enjoyed singing.', chinese: '她喜欢唱歌。', scenario: '询问孩子表现' },
      { id: 'cc-81', english: 'She was very energetic.', chinese: '她非常有活力。', scenario: '询问孩子表现' },
      { id: 'cc-82', english: 'She had trouble focusing.', chinese: '她注意力不集中。', scenario: '询问孩子表现' },
      { id: 'cc-83', english: 'She learned some new words.', chinese: '她学了几个新词。', scenario: '询问孩子表现' },
      { id: 'cc-84', english: 'She loved story time.', chinese: '她喜欢听故事。', scenario: '询问孩子表现' },
      // 参加活动
      { id: 'cc-85', english: 'She painted a picture.', chinese: '她画了一幅画。', scenario: '参加活动' },
      { id: 'cc-86', english: 'She played outside.', chinese: '她在外面玩。', scenario: '参加活动' },
      { id: 'cc-87', english: 'She built a tower with blocks.', chinese: '她用积木搭了一个塔。', scenario: '参加活动' },
      { id: 'cc-88', english: 'She played in the sandpit.', chinese: '她在沙坑里玩。', scenario: '参加活动' },
      { id: 'cc-89', english: 'She enjoyed the music session.', chinese: '她很喜欢音乐时间。', scenario: '参加活动' },
      { id: 'cc-90', english: 'She participated in group games.', chinese: '她参加了集体游戏。', scenario: '参加活动' },
      { id: 'cc-91', english: 'She planted a seed.', chinese: '她种了一颗种子。', scenario: '参加活动' },
      { id: 'cc-92', english: 'She danced with her friends.', chinese: '她和朋友跳舞。', scenario: '参加活动' },
      { id: 'cc-93', english: 'She made a craft.', chinese: '她做了手工。', scenario: '参加活动' },
      { id: 'cc-94', english: 'She practiced letters.', chinese: '她练习写字母。', scenario: '参加活动' },
      { id: 'cc-95', english: 'She read books with the teacher.', chinese: '她和老师一起读书。', scenario: '参加活动' },
      { id: 'cc-96', english: 'She did yoga.', chinese: '她做了瑜伽。', scenario: '参加活动' },
      // 家长会沟通
      { id: 'cc-97', english: 'We would like to discuss her progress.', chinese: '我们想讨论她的进步。', scenario: '家长会沟通' },
      { id: 'cc-98', english: 'She is improving her social skills.', chinese: '她的社交能力在进步。', scenario: '家长会沟通' },
      { id: 'cc-99', english: 'We recommend more reading at home.', chinese: '我们建议在家多读书。', scenario: '家长会沟通' },
      { id: 'cc-100', english: 'She enjoys art activities.', chinese: '她喜欢艺术活动。', scenario: '家长会沟通' },
      { id: 'cc-101', english: 'She needs more practice with numbers.', chinese: '她需要更多数字练习。', scenario: '家长会沟通' },
      { id: 'cc-102', english: 'Her speech is developing well.', chinese: '她的语言发展很好。', scenario: '家长会沟通' },
      { id: 'cc-103', english: 'She is very kind to others.', chinese: '她对别人很友好。', scenario: '家长会沟通' },
      { id: 'cc-104', english: 'We are concerned about her attention span.', chinese: '我们担心她的注意力。', scenario: '家长会沟通' },
      { id: 'cc-105', english: 'She is adjusting well to the routine.', chinese: '她适应了日常安排。', scenario: '家长会沟通' },
      { id: 'cc-106', english: "Let's set some goals together.", chinese: '让我们一起设定目标。', scenario: '家长会沟通' },
      { id: 'cc-107', english: 'She could benefit from more outdoor play.', chinese: '她可以多参加户外活动。', scenario: '家长会沟通' },
      { id: 'cc-108', english: 'We are happy with her progress.', chinese: '我们对她的进步感到满意。', scenario: '家长会沟通' }
    ];
  }

  // 护理英语（Nursing English）
  if (!window.nursingData) {
    window.nursingData = [
      // Vital Signs (生命体征)
      { id: 'n-1', english: 'Please sit still while I take your blood pressure.', chinese: '请坐好，我要测量您的血压。', scenario: 'Vital Signs' },
      { id: 'n-2', english: 'Can you roll up your sleeve?', chinese: '请把袖子卷起来。', scenario: 'Vital Signs' },
      { id: 'n-3', english: 'Your temperature is a little high.', chinese: '您的体温有点高。', scenario: 'Vital Signs' },
      { id: 'n-4', english: 'I will check your pulse.', chinese: '我来测一下您的脉搏。', scenario: 'Vital Signs' },
      { id: 'n-5', english: 'Take a deep breath for me.', chinese: '请深呼吸。', scenario: 'Vital Signs' },
      { id: 'n-6', english: 'Let me listen to your lungs.', chinese: '让我听听您的肺部。', scenario: 'Vital Signs' },
      { id: 'n-7', english: 'Your oxygen level is normal.', chinese: '您的血氧水平正常。', scenario: 'Vital Signs' },
      { id: 'n-8', english: 'Hold out your arm.', chinese: '请伸出手臂。', scenario: 'Vital Signs' },
      { id: 'n-9', english: 'Have you been feeling dizzy?', chinese: '您最近有没有头晕？', scenario: 'Vital Signs' },
      { id: 'n-10', english: 'Do you feel any pain?', chinese: '您觉得疼吗？', scenario: 'Vital Signs' },
      { id: 'n-11', english: 'Your blood pressure is low.', chinese: '您的血压有点低。', scenario: 'Vital Signs' },
      { id: 'n-12', english: 'I need to take your weight.', chinese: '我需要测量您的体重。', scenario: 'Vital Signs' },
      { id: 'n-13', english: 'Please stand on the scale.', chinese: '请站在秤上。', scenario: 'Vital Signs' },
      { id: 'n-14', english: 'How many times have you vomited?', chinese: '您呕吐了几次？', scenario: 'Vital Signs' },
      { id: 'n-15', english: 'Have you had any fever?', chinese: '您有发烧吗？', scenario: 'Vital Signs' },
      { id: 'n-16', english: 'Your heart rate is irregular.', chinese: '您的心率不规律。', scenario: 'Vital Signs' },
      { id: 'n-17', english: 'I will check your blood sugar.', chinese: '我来测一下您的血糖。', scenario: 'Vital Signs' },
      { id: 'n-18', english: 'Did you fast this morning?', chinese: '您今天早上空腹了吗？', scenario: 'Vital Signs' },
      { id: 'n-19', english: "I'm going to take your temperature under your tongue.", chinese: '我要把体温计放在您的舌下。', scenario: 'Vital Signs' },
      { id: 'n-20', english: 'Please lie down for a few minutes.', chinese: '请躺几分钟。', scenario: 'Vital Signs' },
      { id: 'n-21', english: 'I will check your respiration rate.', chinese: '我来测一下您的呼吸频率。', scenario: 'Vital Signs' },
      { id: 'n-22', english: 'Please relax your arm.', chinese: '请放松手臂。', scenario: 'Vital Signs' },
      { id: 'n-23', english: 'Your pulse is strong.', chinese: '您的脉搏很强。', scenario: 'Vital Signs' },
      { id: 'n-24', english: 'Your vital signs are stable.', chinese: '您的生命体征稳定。', scenario: 'Vital Signs' },
      { id: 'n-25', english: 'We will monitor you closely.', chinese: '我们会密切监测您。', scenario: 'Vital Signs' },
      // Medication Administration (用药管理)
      { id: 'n-26', english: 'Have you taken this medication before?', chinese: '您以前服用过这种药吗？', scenario: 'Medication Administration' },
      { id: 'n-27', english: 'Here is your pain medication.', chinese: '这是您的止痛药。', scenario: 'Medication Administration' },
      { id: 'n-28', english: 'Do you have any allergies to medications?', chinese: '您对药物过敏吗？', scenario: 'Medication Administration' },
      { id: 'n-29', english: 'Take this pill with water.', chinese: '用水服下这片药。', scenario: 'Medication Administration' },
      { id: 'n-30', english: 'This injection may sting a little.', chinese: '这个注射可能会有点疼。', scenario: 'Medication Administration' },
      { id: 'n-31', english: "I'm going to give you an IV drip.", chinese: '我要给您挂点滴。', scenario: 'Medication Administration' },
      { id: 'n-32', english: 'Let me clean the injection site.', chinese: '让我清洁一下注射部位。', scenario: 'Medication Administration' },
      { id: 'n-33', english: 'You need this antibiotic twice a day.', chinese: '您需要每天服用两次这种抗生素。', scenario: 'Medication Administration' },
      { id: 'n-34', english: 'Please finish the whole course.', chinese: '请完成整个疗程。', scenario: 'Medication Administration' },
      { id: 'n-35', english: 'Have you experienced any side effects?', chinese: '您有任何副作用吗？', scenario: 'Medication Administration' },
      { id: 'n-36', english: "Don't operate machinery after taking this.", chinese: '服用后请勿操作机器。', scenario: 'Medication Administration' },
      { id: 'n-37', english: 'We will adjust your dosage.', chinese: '我们会调整您的剂量。', scenario: 'Medication Administration' },
      { id: 'n-38', english: 'Please swallow the tablet whole.', chinese: '请整片吞服。', scenario: 'Medication Administration' },
      { id: 'n-39', english: 'This medicine should be taken with food.', chinese: '这种药需要随餐服用。', scenario: 'Medication Administration' },
      { id: 'n-40', english: "I'll show you how to use the inhaler.", chinese: '我教您如何使用吸入器。', scenario: 'Medication Administration' },
      { id: 'n-41', english: 'Do not drink alcohol with this medication.', chinese: '服用该药期间请不要喝酒。', scenario: 'Medication Administration' },
      { id: 'n-42', english: 'Take one tablet every 6 hours.', chinese: '每六小时服用一片。', scenario: 'Medication Administration' },
      { id: 'n-43', english: "I'm going to flush your IV line.", chinese: '我要冲洗您的静脉线路。', scenario: 'Medication Administration' },
      { id: 'n-44', english: 'Let me double-check your chart.', chinese: '让我再核对一下您的病历。', scenario: 'Medication Administration' },
      { id: 'n-45', english: 'Please hold the cotton on the injection site.', chinese: '请按住注射部位的棉球。', scenario: 'Medication Administration' },
      { id: 'n-46', english: 'We need to record the time of administration.', chinese: '我们需要记录用药时间。', scenario: 'Medication Administration' },
      { id: 'n-47', english: "I'll prepare your insulin.", chinese: '我来准备您的胰岛素。', scenario: 'Medication Administration' },
      { id: 'n-48', english: 'Make sure to shake the bottle well.', chinese: '请务必摇匀瓶子。', scenario: 'Medication Administration' },
      { id: 'n-49', english: "Don't miss a dose.", chinese: '不要漏服。', scenario: 'Medication Administration' },
      { id: 'n-50', english: "We'll switch you to oral medication tomorrow.", chinese: '我们明天会换成口服药。', scenario: 'Medication Administration' },
      // Patient Assessment (患者评估)
      { id: 'n-51', english: 'Where is your pain located?', chinese: '您的疼痛在哪里？', scenario: 'Patient Assessment' },
      { id: 'n-52', english: 'On a scale of 1 to 10, how bad is your pain?', chinese: '在1到10的范围内，您的疼痛程度是多少？', scenario: 'Patient Assessment' },
      { id: 'n-53', english: 'Do you feel short of breath?', chinese: '您感觉喘不上气吗？', scenario: 'Patient Assessment' },
      { id: 'n-54', english: 'Have you had any nausea?', chinese: '您有恶心吗？', scenario: 'Patient Assessment' },
      { id: 'n-55', english: 'Are you able to eat?', chinese: '您能吃东西吗？', scenario: 'Patient Assessment' },
      { id: 'n-56', english: 'Can you walk to the bathroom?', chinese: '您可以走到卫生间吗？', scenario: 'Patient Assessment' },
      { id: 'n-57', english: 'Have you been passing urine normally?', chinese: '您的排尿正常吗？', scenario: 'Patient Assessment' },
      { id: 'n-58', english: 'Are you feeling weak?', chinese: '您觉得虚弱吗？', scenario: 'Patient Assessment' },
      { id: 'n-59', english: 'Do you have any swelling?', chinese: '您有肿胀吗？', scenario: 'Patient Assessment' },
      { id: 'n-60', english: 'When did the pain start?', chinese: '疼痛是什么时候开始的？', scenario: 'Patient Assessment' },
      { id: 'n-61', english: 'Is the pain sharp or dull?', chinese: '疼痛是尖锐的还是钝痛？', scenario: 'Patient Assessment' },
      { id: 'n-62', english: 'Does anything make it better?', chinese: '有什么能缓解疼痛吗？', scenario: 'Patient Assessment' },
      { id: 'n-63', english: 'Are you currently taking any medication?', chinese: '您目前在服用任何药物吗？', scenario: 'Patient Assessment' },
      { id: 'n-64', english: 'Do you have any allergies?', chinese: '您有过敏史吗？', scenario: 'Patient Assessment' },
      { id: 'n-65', english: 'Have you had surgery before?', chinese: '您做过手术吗？', scenario: 'Patient Assessment' },
      { id: 'n-66', english: 'Can you rate your level of fatigue?', chinese: '您能评估一下自己的疲劳程度吗？', scenario: 'Patient Assessment' },
      { id: 'n-67', english: 'Do you have any numbness?', chinese: '您有麻木感吗？', scenario: 'Patient Assessment' },
      { id: 'n-68', english: 'Are you feeling anxious?', chinese: '您觉得焦虑吗？', scenario: 'Patient Assessment' },
      { id: 'n-69', english: 'When was your last bowel movement?', chinese: '您上次排便是什么时候？', scenario: 'Patient Assessment' },
      { id: 'n-70', english: 'Are you feeling dizzy when standing?', chinese: '您站起来时会头晕吗？', scenario: 'Patient Assessment' },
      { id: 'n-71', english: 'How is your appetite?', chinese: '您的食欲如何？', scenario: 'Patient Assessment' },
      { id: 'n-72', english: 'Do you have trouble sleeping?', chinese: '您睡眠有困难吗？', scenario: 'Patient Assessment' },
      { id: 'n-73', english: 'Have you lost weight recently?', chinese: '您最近有体重下降吗？', scenario: 'Patient Assessment' },
      { id: 'n-74', english: 'Does the pain radiate to other parts of your body?', chinese: '疼痛会扩散到身体其他部位吗？', scenario: 'Patient Assessment' },
      { id: 'n-75', english: 'Is your vision blurry?', chinese: '您的视力模糊吗？', scenario: 'Patient Assessment' },
      // Clinical Placement (临床实习)
      { id: 'n-76', english: "Let's wash our hands first.", chinese: '让我们先洗手。', scenario: 'Clinical Placement' },
      { id: 'n-77', english: 'Please put on gloves.', chinese: '请戴上手套。', scenario: 'Clinical Placement' },
      { id: 'n-78', english: "We'll perform wound dressing now.", chinese: '我们现在为伤口换药。', scenario: 'Clinical Placement' },
      { id: 'n-79', english: 'Observe how to insert a catheter.', chinese: '观察如何插入导尿管。', scenario: 'Clinical Placement' },
      { id: 'n-80', english: 'Remember to maintain patient privacy.', chinese: '记得要保持患者隐私。', scenario: 'Clinical Placement' },
      { id: 'n-81', english: "Check the patient's ID band.", chinese: '检查患者的腕带。', scenario: 'Clinical Placement' },
      { id: 'n-82', english: "We'll change the bed linen.", chinese: '我们要换床单。', scenario: 'Clinical Placement' },
      { id: 'n-83', english: 'Help me turn the patient.', chinese: '帮我翻身病人。', scenario: 'Clinical Placement' },
      { id: 'n-84', english: 'Monitor the IV fluid rate.', chinese: '监测静脉输液速度。', scenario: 'Clinical Placement' },
      { id: 'n-85', english: "Chart the patient's intake and output.", chinese: '记录患者的摄入和排出。', scenario: 'Clinical Placement' },
      { id: 'n-86', english: "Make sure the patient is comfortable.", chinese: '确保患者舒适。', scenario: 'Clinical Placement' },
      { id: 'n-87', english: 'Prepare the sterile field.', chinese: '准备无菌区域。', scenario: 'Clinical Placement' },
      { id: 'n-88', english: 'Dispose of the sharp safely.', chinese: '安全处理锐器。', scenario: 'Clinical Placement' },
      { id: 'n-89', english: "Let's review the procedure steps.", chinese: '让我们复习一下步骤。', scenario: 'Clinical Placement' },
      { id: 'n-90', english: 'Remember to document everything.', chinese: '记得记录所有内容。', scenario: 'Clinical Placement' },
      // Handover (交接班)
      { id: 'n-91', english: 'The patient in bed 3 is stable.', chinese: '3号床的病人情况稳定。', scenario: 'Handover' },
      { id: 'n-92', english: 'She has a low-grade fever.', chinese: '她有低烧。', scenario: 'Handover' },
      { id: 'n-93', english: 'He had his medication at 9 am.', chinese: '他在上午9点服药了。', scenario: 'Handover' },
      { id: 'n-94', english: 'She needs a fluid restriction.', chinese: '她需要限制液体摄入。', scenario: 'Handover' },
      { id: 'n-95', english: 'He will have an X-ray this afternoon.', chinese: '他下午要做X光检查。', scenario: 'Handover' },
      { id: 'n-96', english: 'She requires assistance with mobility.', chinese: '她需要帮助移动。', scenario: 'Handover' },
      { id: 'n-97', english: 'He is allergic to penicillin.', chinese: '他对青霉素过敏。', scenario: 'Handover' },
      { id: 'n-98', english: 'She is on a soft diet.', chinese: '她在吃软食。', scenario: 'Handover' },
      { id: 'n-99', english: 'He needs to be repositioned every 2 hours.', chinese: '他需要每两小时翻身一次。', scenario: 'Handover' },
      { id: 'n-100', english: 'She is waiting for a CT scan.', chinese: '她在等CT检查。', scenario: 'Handover' },
      { id: 'n-101', english: 'He has IV antibiotics.', chinese: '他有静脉注射抗生素。', scenario: 'Handover' },
      { id: 'n-102', english: 'She is nil by mouth since midnight.', chinese: '她午夜之后禁食。', scenario: 'Handover' },
      { id: 'n-103', english: 'He needs a blood transfusion.', chinese: '他需要输血。', scenario: 'Handover' },
      { id: 'n-104', english: 'She had surgery yesterday.', chinese: '她昨天做了手术。', scenario: 'Handover' },
      { id: 'n-105', english: 'He is awaiting lab results.', chinese: '他在等化验结果。', scenario: 'Handover' },
      { id: 'n-106', english: 'She needs pain assessment.', chinese: '她需要评估疼痛。', scenario: 'Handover' },
      { id: 'n-107', english: 'He has a urinary catheter.', chinese: '他有尿管。', scenario: 'Handover' },
      { id: 'n-108', english: 'She is confused at times.', chinese: '她有时意识模糊。', scenario: 'Handover' },
      { id: 'n-109', english: 'He has been vomiting.', chinese: '他一直呕吐。', scenario: 'Handover' },
      { id: 'n-110', english: 'She requires wound care twice daily.', chinese: '她需要每天两次伤口护理。', scenario: 'Handover' },
      { id: 'n-111', english: 'He is on oxygen therapy.', chinese: '他在进行吸氧治疗。', scenario: 'Handover' },
      { id: 'n-112', english: 'She is not tolerating the diet.', chinese: '她无法接受这种饮食。', scenario: 'Handover' },
      { id: 'n-113', english: 'He complains of shortness of breath.', chinese: '他抱怨呼吸困难。', scenario: 'Handover' },
      { id: 'n-114', english: 'She is at risk of falls.', chinese: '她有跌倒的风险。', scenario: 'Handover' },
      { id: 'n-115', english: 'He has a bed sore.', chinese: '他有褥疮。', scenario: 'Handover' },
      { id: 'n-116', english: 'She needs frequent toileting.', chinese: '她需要频繁如厕。', scenario: 'Handover' },
      { id: 'n-117', english: 'He requires fluid restriction.', chinese: '他需要限制液体摄入。', scenario: 'Handover' },
      { id: 'n-118', english: 'She had a fall last week.', chinese: '她上周摔倒了。', scenario: 'Handover' },
      { id: 'n-119', english: 'She is diabetic.', chinese: '她是糖尿病患者。', scenario: 'Handover' },
      { id: 'n-120', english: 'She has been restless.', chinese: '她一直不安。', scenario: 'Handover' },
      { id: 'n-121', english: 'She is scheduled for surgery tomorrow.', chinese: '她计划明天手术。', scenario: 'Handover' },
      { id: 'n-122', english: 'She needs assistance to shower.', chinese: '她需要协助洗澡。', scenario: 'Handover' },
      { id: 'n-123', english: 'Please update her care plan.', chinese: '请更新她的护理计划。', scenario: 'Handover' },
      { id: 'n-124', english: 'She ate 50% of her meal.', chinese: '她吃了50%的饭。', scenario: 'Handover' },
      { id: 'n-125', english: 'She is on oxygen via nasal prongs.', chinese: '她通过鼻塞吸氧。', scenario: 'Handover' },
      // SBAR Communication (SBAR沟通)
      { id: 'n-126', english: 'Situation: The patient is complaining of chest pain.', chinese: '情境：病人胸痛。', scenario: 'SBAR Communication' },
      { id: 'n-127', english: 'Background: She has a history of heart disease.', chinese: '背景：她有心脏病史。', scenario: 'SBAR Communication' },
      { id: 'n-128', english: 'Assessment: Her blood pressure is 90/60 and pulse is 110.', chinese: '评估：她的血压是90/60，脉搏110。', scenario: 'SBAR Communication' },
      { id: 'n-129', english: 'Recommendation: I think she needs to be reviewed urgently.', chinese: '建议：我认为需要紧急会诊。', scenario: 'SBAR Communication' },
      { id: 'n-130', english: 'Situation: The wound site is red and swollen.', chinese: '情境：伤口处红肿。', scenario: 'SBAR Communication' },
      { id: 'n-131', english: 'Background: He had surgery two days ago.', chinese: '背景：他两天前做了手术。', scenario: 'SBAR Communication' },
      { id: 'n-132', english: 'Assessment: His temperature is 38.5 °C.', chinese: '评估：他的体温是38.5摄氏度。', scenario: 'SBAR Communication' },
      { id: 'n-133', english: 'Recommendation: Should we start antibiotics?', chinese: '建议：我们是否应该开始抗生素？', scenario: 'SBAR Communication' },
      { id: 'n-134', english: 'Situation: Patient’s blood sugar is low.', chinese: '情境：病人的血糖低。', scenario: 'SBAR Communication' },
      { id: 'n-135', english: 'Background: She is on insulin therapy.', chinese: '背景：她正在接受胰岛素治疗。', scenario: 'SBAR Communication' },
      { id: 'n-136', english: 'Assessment: She looks pale and sweaty.', chinese: '评估：她看起来苍白且冒汗。', scenario: 'SBAR Communication' },
      { id: 'n-137', english: 'Recommendation: Would you like me to give glucose?', chinese: '建议：您需要我给她补充葡萄糖吗？', scenario: 'SBAR Communication' },
      { id: 'n-138', english: 'Situation: He is short of breath.', chinese: '情境：他呼吸困难。', scenario: 'SBAR Communication' },
      { id: 'n-139', english: 'Background: He has chronic obstructive pulmonary disease.', chinese: '背景：他有慢性阻塞性肺病。', scenario: 'SBAR Communication' },
      { id: 'n-140', english: 'Assessment: Oxygen saturation is 88% on room air.', chinese: '评估：室内空气下血氧饱和度88%。', scenario: 'SBAR Communication' },
      { id: 'n-141', english: 'Recommendation: Shall we increase oxygen?', chinese: '建议：是否要提高氧流量？', scenario: 'SBAR Communication' },
      { id: 'n-142', english: "Situation: She hasn't passed urine for 8 hours.", chinese: '情境：她8小时未排尿。', scenario: 'SBAR Communication' },
      { id: 'n-143', english: 'Background: She had surgery this morning.', chinese: '背景：她今天早上做了手术。', scenario: 'SBAR Communication' },
      { id: 'n-144', english: 'Assessment: Her bladder is full.', chinese: '评估：她的膀胱胀满。', scenario: 'SBAR Communication' },
      { id: 'n-145', english: 'Recommendation: Should we insert a catheter?', chinese: '建议：我们是否插导尿管？', scenario: 'SBAR Communication' },
      { id: 'n-146', english: 'Situation: Patient is confused and agitated.', chinese: '情境：病人困惑且激动。', scenario: 'SBAR Communication' },
      { id: 'n-147', english: 'Background: He has dementia.', chinese: '背景：他患有痴呆症。', scenario: 'SBAR Communication' },
      { id: 'n-148', english: 'Assessment: He tried to climb out of bed.', chinese: '评估：他试图下床。', scenario: 'SBAR Communication' },
      { id: 'n-149', english: 'Recommendation: Can we review his sedation?', chinese: '建议：我们要调整他的镇静药吗？', scenario: 'SBAR Communication' },
      { id: 'n-150', english: 'Situation: The IV site is leaking.', chinese: '情境：静脉注射部位漏液。', scenario: 'SBAR Communication' },
      { id: 'n-151', english: 'Background: She has been on IV fluids for 24 hours.', chinese: '背景：她已经输液24小时。', scenario: 'SBAR Communication' },
      { id: 'n-152', english: 'Assessment: The cannula may be dislodged.', chinese: '评估：套管可能脱落。', scenario: 'SBAR Communication' },
      { id: 'n-153', english: 'Recommendation: Shall we replace the cannula?', chinese: '建议：是否更换套管？', scenario: 'SBAR Communication' },
      { id: 'n-154', english: 'Situation: The patient fell in the bathroom.', chinese: '情境：病人在卫生间摔倒。', scenario: 'SBAR Communication' },
      { id: 'n-155', english: 'Background: He is frail and uses a walking frame.', chinese: '背景：他身体虚弱，使用助行架。', scenario: 'SBAR Communication' },
      { id: 'n-156', english: 'Assessment: He has a bruise on his hip.', chinese: '评估：他臀部有瘀伤。', scenario: 'SBAR Communication' },
      { id: 'n-157', english: 'Recommendation: Should we order an X-ray?', chinese: '建议：我们是否要做X光？', scenario: 'SBAR Communication' },
      { id: 'n-158', english: 'Situation: The medication chart is unclear.', chinese: '情境：药物记录不清晰。', scenario: 'SBAR Communication' },
      { id: 'n-159', english: 'Background: There are two orders for pain relief.', chinese: '背景：有两个止痛医嘱。', scenario: 'SBAR Communication' },
      { id: 'n-160', english: 'Assessment: There is a risk of overdose.', chinese: '评估：可能会过量。', scenario: 'SBAR Communication' },
      { id: 'n-161', english: 'Recommendation: Please clarify the orders.', chinese: '建议：请澄清医嘱。', scenario: 'SBAR Communication' },
      { id: 'n-162', english: 'Situation: His blood pressure remains high.', chinese: '情境：他的血压持续偏高。', scenario: 'SBAR Communication' },
      { id: 'n-163', english: 'Background: He was given antihypertensive medication.', chinese: '背景：他服用了降压药。', scenario: 'SBAR Communication' },
      { id: 'n-164', english: 'Assessment: BP is 170/100.', chinese: '评估：血压为170/100。', scenario: 'SBAR Communication' },
      { id: 'n-165', english: 'Recommendation: Should we increase the dose?', chinese: '建议：是否增加剂量？', scenario: 'SBAR Communication' },
      // Aged Care (养老护理)
      { id: 'n-166', english: 'Please take your time, there is no rush.', chinese: '请慢慢来，不着急。', scenario: 'Aged Care' },
      { id: 'n-167', english: 'Can I help you with your meal?', chinese: '我可以帮您吃饭吗？', scenario: 'Aged Care' },
      { id: 'n-168', english: 'Would you like to sit in the lounge?', chinese: '您想坐在休息室吗？', scenario: 'Aged Care' },
      { id: 'n-169', english: 'Do you need assistance with bathing?', chinese: '您需要帮忙洗澡吗？', scenario: 'Aged Care' },
      { id: 'n-170', english: 'Remember to use your walking frame.', chinese: '记得使用您的助行架。', scenario: 'Aged Care' },
      { id: 'n-171', english: "Let's join the group exercise.", chinese: '让我们一起参加集体锻炼。', scenario: 'Aged Care' },
      { id: 'n-172', english: 'How did you sleep last night?', chinese: '您昨晚睡得怎么样？', scenario: 'Aged Care' },
      { id: 'n-173', english: 'Would you like me to read to you?', chinese: '您想让我读书给您听吗？', scenario: 'Aged Care' },
      { id: 'n-174', english: "It's time for your medication.", chinese: '到吃药时间了。', scenario: 'Aged Care' },
      { id: 'n-175', english: 'Are you feeling lonely?', chinese: '您感到孤单吗？', scenario: 'Aged Care' },
      { id: 'n-176', english: 'Do you have any pain?', chinese: '您有疼痛吗？', scenario: 'Aged Care' },
      { id: 'n-177', english: 'Can I adjust your pillow?', chinese: '我可以给您调整枕头吗？', scenario: 'Aged Care' },
      { id: 'n-178', english: 'Do you need to go to the bathroom?', chinese: '您需要去卫生间吗？', scenario: 'Aged Care' },
      { id: 'n-179', english: 'Your family will visit soon.', chinese: '您的家人很快会来看您。', scenario: 'Aged Care' },
      { id: 'n-180', english: "It's important to drink water.", chinese: '多喝水很重要。', scenario: 'Aged Care' },
      { id: 'n-181', english: 'We have art class this afternoon.', chinese: '我们下午有美术课。', scenario: 'Aged Care' },
      { id: 'n-182', english: "Let's put on your glasses.", chinese: '我们把眼镜戴上。', scenario: 'Aged Care' },
      { id: 'n-183', english: 'Would you like some tea?', chinese: '您想喝点茶吗？', scenario: 'Aged Care' },
      { id: 'n-184', english: 'Please ring the bell if you need help.', chinese: '需要帮助请按铃。', scenario: 'Aged Care' },
      { id: 'n-185', english: "I'll help you to stand up.", chinese: '我来扶您站起来。', scenario: 'Aged Care' },
      { id: 'n-186', english: 'Please move carefully.', chinese: '请慢慢移动。', scenario: 'Aged Care' },
      { id: 'n-187', english: 'Would you like to call your family?', chinese: '您想打电话给家人吗？', scenario: 'Aged Care' },
      { id: 'n-188', english: 'Do you prefer to stay in your room?', chinese: '您想留在房间里吗？', scenario: 'Aged Care' },
      { id: 'n-189', english: "Let's go for a short walk.", chinese: '我们去散个步吧。', scenario: 'Aged Care' },
      { id: 'n-190', english: 'Can I help you with your hearing aid?', chinese: '我能帮您调整助听器吗？', scenario: 'Aged Care' },
      // Hospital Communication (医院沟通)
      { id: 'n-191', english: 'Welcome to the ward.', chinese: '欢迎来到病房。', scenario: 'Hospital Communication' },
      { id: 'n-192', english: 'We need to take your details.', chinese: '我们需要登记您的信息。', scenario: 'Hospital Communication' },
      { id: 'n-193', english: 'Please lie down on the bed.', chinese: '请躺在床上。', scenario: 'Hospital Communication' },
      { id: 'n-194', english: 'Do you have your Medicare card?', chinese: '您带了医保卡吗？', scenario: 'Hospital Communication' },
      { id: 'n-195', english: 'How can I assist you?', chinese: '我能为您做些什么？', scenario: 'Hospital Communication' },
      { id: 'n-196', english: 'Visiting hours are over.', chinese: '探视时间结束了。', scenario: 'Hospital Communication' },
      { id: 'n-197', english: 'The doctor will see you soon.', chinese: '医生很快会来看您。', scenario: 'Hospital Communication' },
      { id: 'n-198', english: 'Please sign this consent form.', chinese: '请在这份同意书上签字。', scenario: 'Hospital Communication' },
      { id: 'n-199', english: 'You are scheduled for surgery tomorrow.', chinese: '您预定明天手术。', scenario: 'Hospital Communication' }
    ];
  }

  // 澳洲生活英语（Australian Life）
  if (!window.lifeData) {
    window.lifeData = [
      // 超市购物
      { id: 'life-1', english: 'Where is the bread aisle?', chinese: '面包区在哪里？', scenario: '超市购物' },
      { id: 'life-2', english: 'Do you have any fresh milk?', chinese: '你们有新鲜牛奶吗？', scenario: '超市购物' },
      { id: 'life-3', english: 'Where can I find the rice?', chinese: '我可以在哪里找到大米？', scenario: '超市购物' },
      { id: 'life-4', english: 'Is there a discount on this?', chinese: '这个有折扣吗？', scenario: '超市购物' },
      { id: 'life-5', english: 'Can I get a plastic bag?', chinese: '我可以要一个塑料袋吗？', scenario: '超市购物' },
      { id: 'life-6', english: 'The price tag is missing.', chinese: '这个商品没有价格标签。', scenario: '超市购物' },
      { id: 'life-7', english: 'Where are the eggs?', chinese: '鸡蛋在哪里？', scenario: '超市购物' },
      { id: 'life-8', english: 'Do you sell alcohol here?', chinese: '这里卖酒吗？', scenario: '超市购物' },
      { id: 'life-9', english: "I'm looking for pasta sauce.", chinese: '我在找意大利面酱。', scenario: '超市购物' },
      { id: 'life-10', english: 'Is this organic?', chinese: '这是有机的吗？', scenario: '超市购物' },
      { id: 'life-11', english: 'Do you have a rewards card?', chinese: '你有会员卡吗？', scenario: '超市购物' },
      { id: 'life-12', english: 'Can I pay by card?', chinese: '我可以刷卡吗？', scenario: '超市购物' },
      { id: 'life-13', english: 'Do you accept cash?', chinese: '接受现金吗？', scenario: '超市购物' },
      { id: 'life-14', english: 'Where is the self-checkout?', chinese: '自助结账在哪里？', scenario: '超市购物' },
      { id: 'life-15', english: 'This item is damaged.', chinese: '这个商品损坏了。', scenario: '超市购物' },
      { id: 'life-16', english: 'I need a receipt.', chinese: '我需要收据。', scenario: '超市购物' },
      { id: 'life-17', english: 'Is there a sale on this item?', chinese: '这个商品有促销吗？', scenario: '超市购物' },
      { id: 'life-18', english: 'Where is the dairy section?', chinese: '乳制品区在哪里？', scenario: '超市购物' },
      { id: 'life-19', english: 'Can I return this if it doesn’t fit?', chinese: '如果不合适可以退吗？', scenario: '超市购物' },
      { id: 'life-20', english: 'Do you have any gluten-free options?', chinese: '有无麸质产品吗？', scenario: '超市购物' },
      // 咖啡馆点餐
      { id: 'life-21', english: "I'd like a flat white, please.", chinese: '我想要一杯澳式白咖啡。', scenario: '咖啡馆点餐' },
      { id: 'life-22', english: "Can I have a cappuccino?", chinese: '我可以要一杯卡布奇诺吗？', scenario: '咖啡馆点餐' },
      { id: 'life-23', english: 'Is there soy milk?', chinese: '有豆奶吗？', scenario: '咖啡馆点餐' },
      { id: 'life-24', english: 'Do you have any pastries?', chinese: '你们有糕点吗？', scenario: '咖啡馆点餐' },
      { id: 'life-25', english: 'I’d like a takeaway coffee.', chinese: '我要一杯外带咖啡。', scenario: '咖啡馆点餐' },
      { id: 'life-26', english: 'Can I get a muffin?', chinese: '我可以要一个松饼吗？', scenario: '咖啡馆点餐' },
      { id: 'life-27', english: 'Is there seating available?', chinese: '有座位吗？', scenario: '咖啡馆点餐' },
      { id: 'life-28', english: 'Do you have almond milk?', chinese: '有杏仁奶吗？', scenario: '咖啡馆点餐' },
      { id: 'life-29', english: 'What size coffees do you have?', chinese: '你们有多大杯的咖啡？', scenario: '咖啡馆点餐' },
      { id: 'life-30', english: "I'll have a long black.", chinese: '我要一杯黑咖啡。', scenario: '咖啡馆点餐' },
      { id: 'life-31', english: 'Could you make it extra hot?', chinese: '能做得更烫一点吗？', scenario: '咖啡馆点餐' },
      { id: 'life-32', english: 'Do you serve lunch?', chinese: '你们供应午餐吗？', scenario: '咖啡馆点餐' },
      { id: 'life-33', english: 'Can I see the menu?', chinese: '我可以看一下菜单吗？', scenario: '咖啡馆点餐' },
      { id: 'life-34', english: 'Is there a kids’ menu?', chinese: '有儿童菜单吗？', scenario: '咖啡馆点餐' },
      { id: 'life-35', english: 'Do you take cash?', chinese: '你们收现金吗？', scenario: '咖啡馆点餐' },
      { id: 'life-36', english: 'Could I have that to stay?', chinese: '可以在这里吃吗？', scenario: '咖啡馆点餐' },
      { id: 'life-37', english: 'Is there a restroom?', chinese: '有厕所吗？', scenario: '咖啡馆点餐' },
      { id: 'life-38', english: 'Any dairy-free cakes?', chinese: '有不含乳制品的蛋糕吗？', scenario: '咖啡馆点餐' },
      { id: 'life-39', english: 'Can I have some sugar?', chinese: '可以给我一些糖吗？', scenario: '咖啡馆点餐' },
      { id: 'life-40', english: 'Do you serve breakfast all day?', chinese: '全天供应早餐吗？', scenario: '咖啡馆点餐' },
      // 银行办理业务
      { id: 'life-41', english: "I'd like to open a bank account.", chinese: '我想开一个银行账户。', scenario: '银行办理业务' },
      { id: 'life-42', english: "What documents do I need?", chinese: '我需要准备哪些文件？', scenario: '银行办理业务' },
      { id: 'life-43', english: 'I want to deposit some money.', chinese: '我想存些钱。', scenario: '银行办理业务' },
      { id: 'life-44', english: 'Can I withdraw cash?', chinese: '我可以取现吗？', scenario: '银行办理业务' },
      { id: 'life-45', english: "What's the minimum balance?", chinese: '最低余额是多少？', scenario: '银行办理业务' },
      { id: 'life-46', english: "I'd like to close my account.", chinese: '我想销户。', scenario: '银行办理业务' },
      { id: 'life-47', english: 'Is there a monthly fee?', chinese: '每月有费用吗？', scenario: '银行办理业务' },
      { id: 'life-48', english: 'Do you have online banking?', chinese: '有网上银行吗？', scenario: '银行办理业务' },
      { id: 'life-49', english: 'How long will the transfer take?', chinese: '转账需要多久？', scenario: '银行办理业务' },
      { id: 'life-50', english: 'Can I change my PIN here?', chinese: '我可以在这里修改密码吗？', scenario: '银行办理业务' },
      { id: 'life-51', english: 'Do you offer credit cards?', chinese: '你们有信用卡吗？', scenario: '银行办理业务' },
      { id: 'life-52', english: 'Where is the nearest ATM?', chinese: '最近的自动取款机在哪里？', scenario: '银行办理业务' },
      { id: 'life-53', english: 'I’d like to check my balance.', chinese: '我想查一下余额。', scenario: '银行办理业务' },
      { id: 'life-54', english: 'Is there a foreign transaction fee?', chinese: '有境外交易费吗？', scenario: '银行办理业务' },
      { id: 'life-55', english: 'Do you provide investment advice?', chinese: '你们提供投资建议吗？', scenario: '银行办理业务' },
      { id: 'life-56', english: 'Can I speak to a financial advisor?', chinese: '我可以和理财顾问谈谈吗？', scenario: '银行办理业务' },
      { id: 'life-57', english: "I'd like to increase my withdrawal limit.", chinese: '我想提高取款限额。', scenario: '银行办理业务' },
      { id: 'life-58', english: 'Do you have a safety deposit box?', chinese: '你们有保险箱吗？', scenario: '银行办理业务' },
      { id: 'life-59', english: 'Is this a savings or checking account?', chinese: '这是储蓄账户还是支票账户？', scenario: '银行办理业务' },
      { id: 'life-60', english: 'How do I activate my card?', chinese: '如何激活我的银行卡？', scenario: '银行办理业务' },
      // 看病
      { id: 'life-61', english: 'I have an appointment at 10 am.', chinese: '我预约了上午10点。', scenario: '看病' },
      { id: 'life-62', english: 'Do you have any openings today?', chinese: '今天还有空位吗？', scenario: '看病' },
      { id: 'life-63', english: 'I have a fever and cough.', chinese: '我发烧咳嗽。', scenario: '看病' },
      { id: 'life-64', english: 'I need a prescription refill.', chinese: '我需要续药。', scenario: '看病' },
      { id: 'life-65', english: 'Is bulk billing available?', chinese: '可以使用医疗保险支付吗？', scenario: '看病' },
      { id: 'life-66', english: 'How much is the consultation fee?', chinese: '看诊费用是多少？', scenario: '看病' },
      { id: 'life-67', english: 'My Medicare number is...', chinese: '我的医保卡号码是……', scenario: '看病' },
      { id: 'life-68', english: 'I have private health insurance.', chinese: '我有私人医疗保险。', scenario: '看病' },
      { id: 'life-69', english: "What's wrong with me?", chinese: '我怎么了？', scenario: '看病' },
      { id: 'life-70', english: 'Do I need to see a specialist?', chinese: '我需要看专科医生吗？', scenario: '看病' },
      { id: 'life-71', english: 'Can I get a medical certificate?', chinese: '我可以开病假条吗？', scenario: '看病' },
      { id: 'life-72', english: 'How long will the test results take?', chinese: '检查结果多久出来？', scenario: '看病' },
      { id: 'life-73', english: 'Do I need any vaccinations?', chinese: '我需要接种疫苗吗？', scenario: '看病' },
      { id: 'life-74', english: 'Can you explain the diagnosis?', chinese: '你能解释一下诊断吗？', scenario: '看病' },
      { id: 'life-75', english: 'Are there any side effects?', chinese: '有副作用吗？', scenario: '看病' },
      { id: 'life-76', english: 'Should I fast before the test?', chinese: '做测试前需要禁食吗？', scenario: '看病' },
      { id: 'life-77', english: 'When should I come back?', chinese: '我什么时候回来复诊？', scenario: '看病' },
      { id: 'life-78', english: 'How do I take this medication?', chinese: '这种药怎么服用？', scenario: '看病' },
      { id: 'life-79', english: 'Can I exercise while on this medication?', chinese: '服用这种药期间可以运动吗？', scenario: '看病' },
      { id: 'life-80', english: 'Is this contagious?', chinese: '这个会传染吗？', scenario: '看病' },
      // 租房
      { id: 'life-81', english: 'Is electricity included?', chinese: '包括电费吗？', scenario: '租房' },
      { id: 'life-82', english: 'How long is the lease?', chinese: '租期多长？', scenario: '租房' },
      { id: 'life-83', english: "What's the weekly rent?", chinese: '每周租金是多少？', scenario: '租房' },
      { id: 'life-84', english: 'Is the property furnished?', chinese: '房子有家具吗？', scenario: '租房' },
      { id: 'life-85', english: 'How much is the bond?', chinese: '押金是多少？', scenario: '租房' },
      { id: 'life-86', english: 'Can I keep pets?', chinese: '可以养宠物吗？', scenario: '租房' },
      { id: 'life-87', english: 'Is there heating and cooling?', chinese: '有暖气和空调吗？', scenario: '租房' },
      { id: 'life-88', english: 'When can I move in?', chinese: '什么时候可以入住？', scenario: '租房' },
      { id: 'life-89', english: 'How many bedrooms are there?', chinese: '有几间卧室？', scenario: '租房' },
      { id: 'life-90', english: 'Can I have a garage?', chinese: '有车库吗？', scenario: '租房' },
      { id: 'life-91', english: 'Are bills included?', chinese: '包括账单吗？', scenario: '租房' },
      { id: 'life-92', english: 'Is there public transport nearby?', chinese: '附近有公共交通吗？', scenario: '租房' },
      { id: 'life-93', english: 'Are pets allowed?', chinese: '允许养宠物吗？', scenario: '租房' },
      { id: 'life-94', english: 'When is the rent due?', chinese: '租金什么时候交？', scenario: '租房' },
      { id: 'life-95', english: 'Is there internet available?', chinese: '有互联网吗？', scenario: '租房' },
      { id: 'life-96', english: 'Can we repaint the walls?', chinese: '我们可以重新粉刷墙壁吗？', scenario: '租房' },
      { id: 'life-97', english: 'Is the neighbourhood safe?', chinese: '周边安全吗？', scenario: '租房' },
      { id: 'life-98', english: 'How much notice is required to leave?', chinese: '搬出需要提前多久通知？', scenario: '租房' },
      { id: 'life-99', english: 'Are there any extra fees?', chinese: '有额外费用吗？', scenario: '租房' },
      { id: 'life-100', english: 'Can I extend the lease?', chinese: '我可以延长租期吗？', scenario: '租房' },
      // 求职
      { id: 'life-101', english: "I'm looking for a part-time job.", chinese: '我在找兼职工作。', scenario: '求职' },
      { id: 'life-102', english: 'Do you have any vacancies?', chinese: '你们有空缺吗？', scenario: '求职' },
      { id: 'life-103', english: 'What is the hourly rate?', chinese: '时薪是多少？', scenario: '求职' },
      { id: 'life-104', english: 'Can I apply online?', chinese: '我可以在网上申请吗？', scenario: '求职' },
      { id: 'life-105', english: 'Do I need previous experience?', chinese: '需要相关经验吗？', scenario: '求职' },
      { id: 'life-106', english: 'When can I start?', chinese: '我什么时候可以开始？', scenario: '求职' },
      { id: 'life-107', english: 'Is training provided?', chinese: '提供培训吗？', scenario: '求职' },
      { id: 'life-108', english: 'Do you offer sponsorship?', chinese: '你们提供担保吗？', scenario: '求职' },
      { id: 'life-109', english: 'How many hours per week?', chinese: '每周工作多少小时？', scenario: '求职' },
      { id: 'life-110', english: 'What are the job responsibilities?', chinese: '工作内容有哪些？', scenario: '求职' },
      { id: 'life-111', english: 'Is this position permanent?', chinese: '这个职位是永久的吗？', scenario: '求职' },
      { id: 'life-112', english: 'Do you provide uniforms?', chinese: '你们提供制服吗？', scenario: '求职' },
      { id: 'life-113', english: 'Is there room for growth?', chinese: '有晋升空间吗？', scenario: '求职' },
      { id: 'life-114', english: 'How do I submit my resume?', chinese: '如何提交简历？', scenario: '求职' },
      { id: 'life-115', english: 'Who can I contact for more information?', chinese: '我可以联系谁了解更多信息？', scenario: '求职' },
      { id: 'life-116', english: 'Do you sponsor work visas?', chinese: '你们提供工作签证担保吗？', scenario: '求职' },
      { id: 'life-117', english: 'Is there a probation period?', chinese: '有试用期吗？', scenario: '求职' },
      { id: 'life-118', english: 'What is the company culture like?', chinese: '公司的文化是怎样的？', scenario: '求职' },
      { id: 'life-119', english: 'Do you offer flexible hours?', chinese: '工作时间灵活吗？', scenario: '求职' },
      { id: 'life-120', english: 'What benefits are included?', chinese: '有什么福利？', scenario: '求职' },
      // 社交聊天
      { id: 'life-121', english: 'How long have you been in Australia?', chinese: '你来澳大利亚多久了？', scenario: '社交聊天' },
      { id: 'life-122', english: 'What do you do for fun?', chinese: '你喜欢做什么休闲活动？', scenario: '社交聊天' },
      { id: 'life-123', english: 'Do you like your job?', chinese: '你喜欢你的工作吗？', scenario: '社交聊天' },
      { id: 'life-124', english: 'Have you travelled much?', chinese: '你旅行过很多地方吗？', scenario: '社交聊天' },
      { id: 'life-125', english: 'Where are you from originally?', chinese: '你来自哪里？', scenario: '社交聊天' },
      { id: 'life-126', english: 'Do you miss your home country?', chinese: '你想念你的祖国吗？', scenario: '社交聊天' },
      { id: 'life-127', english: 'What’s your favourite Australian food?', chinese: '你最喜欢的澳大利亚食物是什么？', scenario: '社交聊天' },
      { id: 'life-128', english: 'Do you have any hobbies?', chinese: '你有什么爱好吗？', scenario: '社交聊天' },
      { id: 'life-129', english: 'What’s your favourite place here?', chinese: '你最喜欢这里的哪个地方？', scenario: '社交聊天' },
      { id: 'life-130', english: 'Have you been to the beach yet?', chinese: '你去过海滩吗？', scenario: '社交聊天' },
      { id: 'life-131', english: 'How’s the weather today?', chinese: '今天天气怎么样？', scenario: '社交聊天' },
      { id: 'life-132', english: 'Do you like Australian sports?', chinese: '你喜欢澳大利亚的体育吗？', scenario: '社交聊天' },
      { id: 'life-133', english: 'What’s your favourite movie?', chinese: '你最喜欢的电影是什么？', scenario: '社交聊天' },
      { id: 'life-134', english: 'Have you tried surfing?', chinese: '你尝试过冲浪吗？', scenario: '社交聊天' },
      { id: 'life-135', english: 'Do you have pets?', chinese: '你有宠物吗？', scenario: '社交聊天' },
      { id: 'life-136', english: 'What do you like about Australia?', chinese: '你喜欢澳大利亚的什么？', scenario: '社交聊天' },
      { id: 'life-137', english: 'How was your weekend?', chinese: '你周末过得怎么样？', scenario: '社交聊天' },
      { id: 'life-138', english: 'Do you like camping?', chinese: '你喜欢露营吗？', scenario: '社交聊天' },
      { id: 'life-139', english: 'What’s your favourite Aussie slang?', chinese: '你最喜欢的澳式俚语是什么？', scenario: '社交聊天' },
      { id: 'life-140', english: 'Have you tried Vegemite?', chinese: '你尝过维吉麦酱吗？', scenario: '社交聊天' },
      // 邻里沟通
      { id: 'life-141', english: 'Good morning, how are you?', chinese: '早上好，你好吗？', scenario: '邻里沟通' },
      { id: 'life-142', english: "I'm your new neighbour.", chinese: '我是你的新邻居。', scenario: '邻里沟通' },
      { id: 'life-143', english: 'Let me know if you need anything.', chinese: '如果你需要什么请告诉我。', scenario: '邻里沟通' },
      { id: 'life-144', english: 'Can I borrow some sugar?', chinese: '我可以借点糖吗？', scenario: '邻里沟通' },
      { id: 'life-145', english: 'Your garden looks beautiful.', chinese: '你的花园很漂亮。', scenario: '邻里沟通' },
      { id: 'life-146', english: 'Are you free for a BBQ this weekend?', chinese: '这个周末有空烧烤吗？', scenario: '邻里沟通' },
      { id: 'life-147', english: 'Sorry for the noise last night.', chinese: '抱歉昨晚吵到你了。', scenario: '邻里沟通' },
      { id: 'life-148', english: 'Could you please collect my mail?', chinese: '你可以帮我收一下邮件吗？', scenario: '邻里沟通' },
      { id: 'life-149', english: "I'm having a small get‑together.", chinese: '我办个小聚会。', scenario: '邻里沟通' },
      { id: 'life-150', english: 'Do you know who owns this dog?', chinese: '你知道这只狗是谁的吗？', scenario: '邻里沟通' },
      { id: 'life-151', english: 'The bins will be collected tomorrow.', chinese: '垃圾桶明天收。', scenario: '邻里沟通' },
      { id: 'life-152', english: 'Please keep the gate closed.', chinese: '请关好大门。', scenario: '邻里沟通' },
      { id: 'life-153', english: 'Would you like some vegetables from my garden?', chinese: '你想要一些我菜园的蔬菜吗？', scenario: '邻里沟通' },
      { id: 'life-154', english: "Let's walk together sometime.", chinese: '我们找时间一起散步。', scenario: '邻里沟通' },
      { id: 'life-155', english: 'Do you need help with anything?', chinese: '你需要什么帮助吗？', scenario: '邻里沟通' },
      { id: 'life-156', english: 'Do you have any pets?', chinese: '你有宠物吗？', scenario: '邻里沟通' },
      { id: 'life-157', english: 'Let’s have a coffee sometime.', chinese: '我们找时间喝咖啡吧。', scenario: '邻里沟通' },
      { id: 'life-158', english: 'Could you water my plants while I’m away?', chinese: '我不在的时候可以帮我浇花吗？', scenario: '邻里沟通' },
      { id: 'life-159', english: 'I made some extra cookies, would you like some?', chinese: '我多做了些饼干，你想要一些吗？', scenario: '邻里沟通' },
      { id: 'life-160', english: 'Do you know if there are any community events coming up?', chinese: '你知道近期有社区活动吗？', scenario: '邻里沟通' }
    ];
  }

  // 每日句子
  if (!window.dailySentences) {
    window.dailySentences = [
      { english: 'No worries.', chinese: '没关系。' },
      { english: "She'll be right.", chinese: '她没事的。' },
      { english: "I'm knackered.", chinese: '我累坏了。' },
      { english: 'Catch you later.', chinese: '回头见。' },
      { english: "I’m just having a look, thanks.", chinese: '我只是看看，谢谢。' },
      { english: 'Could I have a takeaway?', chinese: '我可以打包吗？' },
      { english: "It's a bit chilly today.", chinese: '今天有点冷。' },
      { english: "Sorry, I’m running late.", chinese: '抱歉，我要迟到了。' },
      { english: "It's not far from here.", chinese: '离这里不远。' },
      { english: "I'll see what I can do.", chinese: '我会看看能做什么。' },
      { english: 'Just give me a minute.', chinese: '请等我一下。' },
      { english: 'Do you mind if I join you?', chinese: '介意我加入吗？' },
      { english: 'Could you say that again?', chinese: '你能再说一遍吗？' },
      { english: "I don't understand.", chinese: '我不明白。' },
      { english: "That's a good deal.", chinese: '这个很划算。' },
      { english: 'Have a good one!', chinese: '祝你过得愉快！' },
      { english: 'Take care.', chinese: '保重。' },
      { english: "What's the time?", chinese: '现在几点？' },
      { english: "I'm not sure.", chinese: '我不确定。' },
      { english: "It doesn't matter.", chinese: '没关系。' }
    ];
  }

  // 每日短语
  if (!window.dailyPhrases) {
    window.dailyPhrases = [
      { english: 'No worries', chinese: '没关系' },
      { english: 'Fair dinkum', chinese: '真的 / 诚实' },
      { english: 'Bloody oath', chinese: '当然 / 确实' },
      { english: 'Good on ya', chinese: '干得好' },
      { english: "Mate's rates", chinese: '友情价' },
      { english: 'Piece of cake', chinese: '小菜一碟' },
      { english: 'Righto', chinese: '好的' },
      { english: 'Too easy', chinese: '太简单了' },
      { english: 'Good arvo', chinese: '下午好' },
      { english: 'Heaps good', chinese: '非常好' },
      { english: 'No dramas', chinese: '没问题' },
      { english: 'Sweet as', chinese: '很棒' },
      { english: 'Hard yakka', chinese: '辛苦工作' },
      { english: 'Servo', chinese: '加油站' },
      { english: 'Bottle-o', chinese: '酒类商店' },
      { english: 'Brekkie', chinese: '早餐' },
      { english: "Macca's", chinese: '麦当劳' },
      { english: 'Bikkie', chinese: '饼干' },
      { english: 'Brolly', chinese: '雨伞' },
      { english: "G'day", chinese: '你好' }
    ];
  }

  // 每日单词
  if (!window.dailyWords) {
    window.dailyWords = [
      { english: 'arvo', chinese: '下午' },
      { english: 'mate', chinese: '朋友' },
      { english: 'loo', chinese: '厕所' },
      { english: 'thongs', chinese: '拖鞋' },
      { english: 'chook', chinese: '鸡' },
      { english: 'barbie', chinese: '烧烤' },
      { english: 'esky', chinese: '冰箱（便携冷藏箱）' },
      { english: 'snag', chinese: '香肠' },
      { english: 'ute', chinese: '皮卡车' },
      { english: 'rego', chinese: '车辆注册' },
      { english: 'jumper', chinese: '毛衣' },
      { english: 'bogan', chinese: '没文化的人' },
      { english: 'ripper', chinese: '极好的事' },
      { english: 'footy', chinese: '澳式足球' },
      { english: 'drongo', chinese: '笨蛋' },
      { english: 'trackie dacks', chinese: '运动裤' },
      { english: 'cuppa', chinese: '一杯茶' },
      { english: 'sunnies', chinese: '太阳镜' },
      { english: 'mozzie', chinese: '蚊子' },
      { english: 'brolly', chinese: '雨伞' }
    ];
  }

  // Australian Vocabulary fallback: in case data.js fails to load under file:// scheme
  if (!window.vocabData) {
    window.vocabData = [
      { id: 'v-1', english: 'receipt', chinese: '收据' },
      { id: 'v-2', english: 'roster', chinese: '排班表' },
      { id: 'v-3', english: 'bulk billing', chinese: '医保全报销' },
      { id: 'v-4', english: 'rego', chinese: '车辆注册' },
      { id: 'v-5', english: 'trolley', chinese: '购物车' },
      { id: 'v-6', english: 'footpath', chinese: '人行道' },
      { id: 'v-7', english: 'bin', chinese: '垃圾桶' },
      { id: 'v-8', english: 'tyre', chinese: '轮胎' },
      { id: 'v-9', english: 'servo', chinese: '加油站' },
      { id: 'v-10', english: 'bathers', chinese: '泳衣' },
      { id: 'v-11', english: 'op shop', chinese: '旧货店' },
      { id: 'v-12', english: 'metho', chinese: '甲醇（酒精）' },
      { id: 'v-13', english: 'snag', chinese: '香肠' },
      { id: 'v-14', english: 'cuppa', chinese: '一杯茶' },
      { id: 'v-15', english: 'arvo', chinese: '下午' },
      { id: 'v-16', english: 'sanga', chinese: '三明治' },
      { id: 'v-17', english: 'tradie', chinese: '技工、工人' },
      { id: 'v-18', english: 'mozzie', chinese: '蚊子' },
      { id: 'v-19', english: 'firie', chinese: '消防员' },
      { id: 'v-20', english: 'ripper', chinese: '极好的事' }
    ];
  }
}

// 简单的全局错误监听，用于在页面上显示脚本错误，方便调试。
window.addEventListener('error', function(e) {
  const pre = document.createElement('pre');
  pre.style.color = 'red';
  pre.style.background = '#fff2f2';
  pre.style.padding = '0.5rem';
  pre.textContent = 'Error: ' + e.message;
  document.body.appendChild(pre);
});

/*
 * 收藏功能：从 localStorage 读取或保存收藏的表达 ID 列表
 */
function loadFavorites() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.favorites);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

function saveFavorites(arr) {
  localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(arr));
}

function isFavorite(id) {
  const favs = loadFavorites();
  return favs.includes(id);
}

function toggleFavorite(id) {
  let favs = loadFavorites();
  if (favs.includes(id)) {
    favs = favs.filter(item => item !== id);
  } else {
    favs.push(id);
  }
  saveFavorites(favs);
}

/*
 * 复习功能：记录每个表达的复习进度和下次复习时间。
 * reviews 对象结构： { [id]: { stage: Number, nextReview: Number } }
 * stage 表示已经完成的复习次数，0 表示刚加入复习，1 表示完成第一次复习，以此类推。
 */
const reviewSchedule = [0, 1, 2, 4, 7, 15, 30];

function loadReviews() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.reviews);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
}

function saveReviews(obj) {
  localStorage.setItem(STORAGE_KEYS.reviews, JSON.stringify(obj));
}

function getReview(id) {
  const reviews = loadReviews();
  return reviews[id] || null;
}

// 加入复习（或标记为已学习）
function addToReview(id) {
  const reviews = loadReviews();
  reviews[id] = {
    stage: 0,
    nextReview: Date.now()
  };
  saveReviews(reviews);
  // For the new plan-based system we no longer update daily progress here.
}

function markLearned(id) {
  // Marking as learned is equivalent to adding to review. No daily progress updates in the new plan.
  addToReview(id);
}

function markMastered(id) {
  const reviews = loadReviews();
  reviews[id] = {
    stage: reviewSchedule.length,
    nextReview: 0
  };
  saveReviews(reviews);
  // No daily progress update needed for the plan-based system
}

// 完成一次复习：根据当前 stage 计算下一次复习时间
function completeReview(id) {
  const reviews = loadReviews();
  const record = reviews[id];
  if (!record) return;
  const nextStage = record.stage + 1;
  if (nextStage >= reviewSchedule.length) {
    // 进入已掌握状态
    record.stage = reviewSchedule.length;
    record.nextReview = 0;
  } else {
    record.stage = nextStage;
    const intervalDays = reviewSchedule[nextStage];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const nextTime = now.getTime() + intervalDays * 24 * 60 * 60 * 1000;
    record.nextReview = nextTime;
  }
  // 记录复习次数，以便难题本统计
  if (!record.count) {
    record.count = 1;
  } else {
    record.count++;
  }
  reviews[id] = record;
  saveReviews(reviews);
  // No daily progress update needed for the plan-based system
}

/**
 * Enter today's study mode: sequentially present today's review and new items.
 * Hides the hero and feature sections, shows a study container, and
 * automatically progresses to the next card after the user marks each item.
 */
function startTodayStudy() {
  const hero = document.querySelector('.hero');
  const features = document.querySelector('.features');
  const dailySection = document.querySelector('.daily-task');
  const container = document.getElementById('today-study-container');
  if (!container) return;
  // Hide non-study sections
  if (hero) hero.style.display = 'none';
  if (features) features.style.display = 'none';
  if (dailySection) dailySection.style.display = 'none';
  container.style.display = 'block';
  // Generate today's tasks fresh
  const tasks = generateDailyTasks();
  const queueIds = [];
  // Prioritize today's review items first
  if (Array.isArray(tasks.reviewItems)) {
    queueIds.push(...tasks.reviewItems);
  }
  if (Array.isArray(tasks.newItems)) {
    queueIds.push(...tasks.newItems);
  }
  let index = 0;
  function showNext() {
    // If done, display completion message and update UI
    if (index >= queueIds.length) {
      container.innerHTML = '';
      const msg = document.createElement('p');
      msg.textContent = '✅ Today’s Goal Completed';
      container.appendChild(msg);
      // Refresh daily UI to show completion
      updateDailyUI();
      return;
    }
    const id = queueIds[index];
    const item = getItemById(id);
    if (!item) {
      index++;
      showNext();
      return;
    }
    container.innerHTML = '';
    const card = createCard(item, () => {
      index++;
      showNext();
    });
    container.appendChild(card);
  }
  showNext();
}

/**
 * Start the daily study flow according to the user's plan settings. This function
 * builds a queue of today's review and new items grouped by category and
 * presents them one by one. After each action the next item is shown
 * automatically. When all items are completed, a completion message is shown
 * and streak/plan progress is updated.
 */
function startTodayStudyPlan() {
  prepareAllItems();
  const hero = document.querySelector('.hero');
  const featuresSection = document.querySelector('.features');
  const planSection = document.querySelector('.today-plan');
  const statsSection = document.querySelector('.learning-stats');
  const container = document.getElementById('today-study-container');
  if (!container) return;
  // Hide non-study sections on home page
  if (hero) hero.style.display = 'none';
  if (featuresSection) featuresSection.style.display = 'none';
  if (planSection) planSection.style.display = 'none';
  if (statsSection) statsSection.style.display = 'none';
  container.style.display = 'block';
  // Generate tasks
  const tasks = generatePlanTasks();
  const order = ['childcare','nursing','australian','vocab'];
  const queue = [];
  order.forEach(cat => {
    const seg = tasks.plan && tasks.plan[cat];
    if (seg && Array.isArray(seg.list)) {
      seg.list.forEach(id => {
        queue.push({ id, category: cat });
      });
    }
  });
  let index = 0;
  function showNext() {
    if (index >= queue.length) {
      container.innerHTML = '';
      const msg = document.createElement('p');
      msg.textContent = '✅ Today’s Plan Completed';
      container.appendChild(msg);
      // regenerate UI
      updatePlanUI();
      updateStatsUI();
      return;
    }
    const { id, category } = queue[index];
    const item = getItemById(id);
    if (!item) {
      index++;
      showNext();
      return;
    }
    container.innerHTML = '';
    const card = createCard(item, () => {
      index++;
      showNext();
    }, true);
    container.appendChild(card);
    // Auto play is handled by createCard when third argument true
  }
  showNext();
}

/*
 * 日常任务系统
 * 定义每日新学习量、生成每日新内容和复习内容、记录完成情况以及连续打卡天数。
 */

/** 加载日常设置信息（newGoal、streak、lastCompletionDate） */
function loadDailyInfo() {
  try {
    const info = JSON.parse(localStorage.getItem(DAILY_INFO_KEY) || '{}');
    if (!info.newGoal) info.newGoal = 5;
    if (!info.streak) info.streak = 0;
    return info;
  } catch (e) {
    return { newGoal: 5, streak: 0 };
  }
}

/** 保存日常设置信息 */
function saveDailyInfo(info) {
  localStorage.setItem(DAILY_INFO_KEY, JSON.stringify(info));
}

/** 加载当日任务 */
function loadDailyTasks() {
  try {
    const tasks = JSON.parse(localStorage.getItem(DAILY_TASK_KEY) || '{}');
    return tasks || {};
  } catch (e) {
    return {};
  }
}

/** 保存当日任务 */
function saveDailyTasks(tasks) {
  localStorage.setItem(DAILY_TASK_KEY, JSON.stringify(tasks));
}

/**
 * 生成并返回当天任务。如果已生成则直接返回。
 */
function generateDailyTasks() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  let tasks = loadDailyTasks();
  const info = loadDailyInfo();
  // 如果已经生成了当天的任务，但每日目标数量发生变化且当天任务尚未开始，则重新生成
  if (tasks && tasks.date === todayStr) {
    // newGoal 当前目标，默认为 5
    const goal = info.newGoal || 5;
    const newItemsLength = Array.isArray(tasks.newItems) ? tasks.newItems.length : 0;
    // 当新旧目标数量不一致，且未开始学习（新和复习进度均为 0）时，重新生成当天任务
    if (newItemsLength === goal && typeof tasks.newCompleted === 'number' && typeof tasks.reviewCompleted === 'number') {
      // 无需重新生成，直接返回
      return tasks;
    }
    // 若目标数量不一致或进度字段缺失，则在下面重新生成
  }
  // 计算连续天数：如果前一天完成，则 streak 保持；否则重置。
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  if (!info.lastCompletionDate || info.lastCompletionDate !== yesterdayStr) {
    // 断档
    info.streak = 0;
  }
  // 生成新项目列表
  prepareAllItems();
  const reviews = loadReviews();
  // 未学习：没有任何复习记录
  const unlearned = allItems.filter(it => !reviews[it.id]);
  // 打乱顺序
  for (let i = unlearned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unlearned[i], unlearned[j]] = [unlearned[j], unlearned[i]];
  }
  const newGoal = info.newGoal || 5;
  const newItems = unlearned.slice(0, newGoal).map(it => it.id);
  // 生成今天要复习的项目（符合艾宾浩斯时间且未掌握）
  const dueItems = [];
  const todayTime = today.getTime();
  Object.keys(reviews).forEach(id => {
    const rec = reviews[id];
    if (rec.stage < reviewSchedule.length && rec.nextReview <= todayTime) {
      dueItems.push(id);
    }
  });
  tasks = {
    date: todayStr,
    newItems,
    newCompleted: 0,
    reviewItems: dueItems,
    reviewCompleted: 0,
    completed: false
  };
  saveDailyTasks(tasks);
  saveDailyInfo(info);
  return tasks;
}

/**
 * 更新首页的每日任务 UI。如果页面不存在相关元素则忽略。
 */
function updateDailyUI() {
  const newEl = document.getElementById('daily-new-progress');
  if (!newEl) return;
  const tasks = generateDailyTasks();
  // 读取设置信息以获取 newGoal 和 streak
  const info = loadDailyInfo();
  // 更新数值显示
  document.getElementById('daily-new-progress').textContent = tasks.newCompleted + ' / ' + tasks.newItems.length;
  document.getElementById('daily-review-progress').textContent = tasks.reviewCompleted + ' / ' + tasks.reviewItems.length;
  const total = tasks.newItems.length + tasks.reviewItems.length;
  const done = tasks.newCompleted + tasks.reviewCompleted;
  const completion = total === 0 ? 100 : Math.round(done / total * 100);
  document.getElementById('daily-completion').textContent = completion + '%';
  document.getElementById('daily-streak').textContent = info.streak;
  // 设置每日新量选择器
  const selectEl = document.getElementById('daily-goal-select');
  if (selectEl) {
    selectEl.value = info.newGoal;
  }
}

/**
 * 增加日常任务进度。
 * @param {string} type 'new' 或 'review'
 * @param {string} id 项目 ID
 */
function incrementDailyProgress(type, id) {
  const tasks = generateDailyTasks();
  let changed = false;
  if (type === 'new' && tasks.newItems.includes(id) && tasks.newCompleted < tasks.newItems.length) {
    tasks.newCompleted++;
    changed = true;
  }
  if (type === 'review' && tasks.reviewItems.includes(id) && tasks.reviewCompleted < tasks.reviewItems.length) {
    tasks.reviewCompleted++;
    changed = true;
  }
  if (changed) {
    // 判断是否完成
    if (!tasks.completed && tasks.newCompleted >= tasks.newItems.length && tasks.reviewCompleted >= tasks.reviewItems.length) {
      tasks.completed = true;
      // 更新 streak
      const info = loadDailyInfo();
      info.lastCompletionDate = tasks.date;
      info.streak = (info.streak || 0) + 1;
      saveDailyInfo(info);
    }
    saveDailyTasks(tasks);
  }
}

/**
 * 获取难题本条目：根据复习次数统计
 */
function getDifficultItems() {
  // Use user-marked difficult list instead of review count
  prepareAllItems();
  const ids = loadDifficult();
  return ids.map(id => getItemById(id)).filter(item => item !== null);
}

/*
 * 整合所有学习项目，构建用于搜索和复习的统一列表。
 * 每个项目附加字段 category，用于区分所属模块。
 */
let allItems = [];
let itemsMap = {};

function prepareAllItems() {
  if (allItems.length > 0) return;
  // 幼儿园
  if (Array.isArray(window.childcareData)) {
    window.childcareData.forEach(item => {
      const obj = Object.assign({}, item, { category: 'childcare' });
      allItems.push(obj);
      itemsMap[item.id] = obj;
    });
  }
  // 护理
  if (Array.isArray(window.nursingData)) {
    window.nursingData.forEach(item => {
      const obj = Object.assign({}, item, { category: 'nursing' });
      allItems.push(obj);
      itemsMap[item.id] = obj;
    });
  }
  // Australian English (life)
  if (Array.isArray(window.lifeData)) {
    window.lifeData.forEach(item => {
      const obj = Object.assign({}, item, { category: 'australian' });
      allItems.push(obj);
      itemsMap[item.id] = obj;
    });
  }
  // Australian vocabulary
  if (Array.isArray(window.vocabData)) {
    window.vocabData.forEach(item => {
      const obj = Object.assign({}, item, { category: 'vocab' });
      allItems.push(obj);
      itemsMap[item.id] = obj;
    });
  }
  // 每日句子
  if (Array.isArray(window.dailySentences)) {
    window.dailySentences.forEach((item, index) => {
      const id = 'ds-' + (index + 1);
      const obj = Object.assign({}, item, { id, category: 'dailySentence', scenario: 'Daily Sentence' });
      allItems.push(obj);
      itemsMap[id] = obj;
    });
  }
  if (Array.isArray(window.dailyPhrases)) {
    window.dailyPhrases.forEach((item, index) => {
      const id = 'dp-' + (index + 1);
      const obj = Object.assign({}, item, { id, category: 'dailyPhrase', scenario: 'Daily Phrase' });
      allItems.push(obj);
      itemsMap[id] = obj;
    });
  }
  if (Array.isArray(window.dailyWords)) {
    window.dailyWords.forEach((item, index) => {
      const id = 'dw-' + (index + 1);
      const obj = Object.assign({}, item, { id, category: 'dailyWord', scenario: 'Daily Word' });
      allItems.push(obj);
      itemsMap[id] = obj;
    });
  }

  // 自定义条目：从 localStorage 中读取用户通过 Quick Add/Smart Add 保存的条目
  try {
    const customArr = JSON.parse(localStorage.getItem('efra_custom') || '[]');
    if (Array.isArray(customArr)) {
      customArr.forEach(item => {
        if (item && item.id && item.english) {
          const obj = Object.assign({}, item);
          allItems.push(obj);
          itemsMap[obj.id] = obj;
        }
      });
    }
  } catch (e) {
    console.error('Error loading custom items:', e);
  }
}

// 根据 ID 获取项目
function getItemById(id) {
  prepareAllItems();
  return itemsMap[id] || null;
}

// 格式化时间为 yyyy-mm-dd
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 创建单个卡片的 DOM
function createCard(item, onDone, autoplay = false) {
  const card = document.createElement('div');
  card.className = 'phrase-card';
  // 语音播放按钮
  const listenBtn = document.createElement('button');
  listenBtn.className = 'listen-btn';
  listenBtn.textContent = '🔊';
  listenBtn.title = 'Listen';
  listenBtn.addEventListener('click', () => {
    speak(item.english);
  });
  card.appendChild(listenBtn);
  // 英文文本
  const englishP = document.createElement('p');
  englishP.className = 'english';
  englishP.textContent = item.english;
  card.appendChild(englishP);
  // 场景或分类
  // 极简学习模式下，不再在卡片中显示场景或分类信息，减少视觉干扰。
  // 如果需要可以在此恢复显示，例如：
  // const descP = document.createElement('p');
  // descP.className = 'description';
  // descP.textContent = item.scenario || item.category || '';
  // card.appendChild(descP);
  // Translation toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'toggle-btn';
  // Show/hide labels for translation toggle. Use simple English-only labels.
  toggleBtn.dataset.showText = 'Chinese';
  toggleBtn.dataset.hideText = 'English';
  // Default state: translation hidden, so button shows 'Chinese'
  toggleBtn.textContent = toggleBtn.dataset.showText;
  card.appendChild(toggleBtn);
  // Translation content
  const translationP = document.createElement('p');
  translationP.className = 'translation';
  translationP.style.display = 'none';
  translationP.textContent = item.chinese;
  card.appendChild(translationP);

  // 极简学习模式不再显示使用场景、示例句和示例翻译，
  // 以减小信息量，提升学习效率。
  // 如果需要恢复显示，可以取消以下注释并依据 item.scenario/example 添加元素。
  // 切换翻译事件
  toggleBtn.addEventListener('click', () => {
    // Toggle visibility of translation and update button label
    if (translationP.style.display === 'none' || translationP.style.display === '') {
      translationP.style.display = 'block';
      toggleBtn.textContent = toggleBtn.dataset.hideText;
    } else {
      translationP.style.display = 'none';
      toggleBtn.textContent = toggleBtn.dataset.showText;
    }
  });
  // Actions container: holds review and mastery buttons
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'card-actions';
  // 复习与学习按钮
  function appendReviewControls() {
    // Clear all existing buttons
    while (actionsDiv.firstChild) {
      actionsDiv.removeChild(actionsDiv.firstChild);
    }
    const record = getReview(item.id);
    // Helper to proceed to next card if callback is provided
    function finishAction() {
      // Increment plan progress if applicable
      if (item.category) {
        incrementPlanProgress(item.category);
      }
      if (typeof onDone === 'function') {
        onDone();
      } else if (typeof window.currentPageRender === 'function') {
        window.currentPageRender();
      }
    }
    // Determine buttons based on review status
    if (!record) {
      // Item not yet in review: provide Review and Mastered options
      const reviewBtn = document.createElement('button');
      reviewBtn.className = 'add-review-btn';
      reviewBtn.textContent = '❤️ Review';
      reviewBtn.addEventListener('click', () => {
        addToReview(item.id);
        appendReviewControls();
        finishAction();
      });
      actionsDiv.appendChild(reviewBtn);
      const masterBtn = document.createElement('button');
      masterBtn.className = 'master-btn';
      masterBtn.textContent = '✅ Mastered';
      masterBtn.addEventListener('click', () => {
        markMastered(item.id);
        appendReviewControls();
        finishAction();
      });
      actionsDiv.appendChild(masterBtn);
    } else {
      // Item is in review schedule
      if (record.stage >= reviewSchedule.length) {
        // Already mastered: show disabled button
        const masteredBtn = document.createElement('button');
        masteredBtn.className = 'master';
        masteredBtn.textContent = '✅ Mastered';
        masteredBtn.disabled = true;
        actionsDiv.appendChild(masteredBtn);
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (record.nextReview <= today.getTime()) {
          // Due for review today
          const reviewBtn = document.createElement('button');
          reviewBtn.className = 'review-today';
          reviewBtn.textContent = '❤️ Review';
          reviewBtn.addEventListener('click', () => {
            completeReview(item.id);
            appendReviewControls();
            finishAction();
          });
          actionsDiv.appendChild(reviewBtn);
        } else {
          // Not yet due: show schedule disabled
          const scheduleBtn = document.createElement('button');
          scheduleBtn.className = 'scheduled';
          scheduleBtn.textContent = 'Review on ' + formatDate(record.nextReview);
          scheduleBtn.disabled = true;
          actionsDiv.appendChild(scheduleBtn);
        }
        // Always allow manual mastery
        const masterBtn = document.createElement('button');
        masterBtn.className = 'master-btn';
        masterBtn.textContent = '✅ Mastered';
        masterBtn.addEventListener('click', () => {
          markMastered(item.id);
          appendReviewControls();
          finishAction();
        });
        actionsDiv.appendChild(masterBtn);
      }
    }
  }
  appendReviewControls();
  card.appendChild(actionsDiv);
  // Auto play pronunciation when enabled
  if (autoplay) {
    // Use a slight delay to ensure DOM updates
    setTimeout(() => {
      speak(item.english);
    }, 100);
  }
  return card;
}

// 渲染列表到容器
function renderList(container, items) {
  container.innerHTML = '';
  items.forEach(item => {
    const card = createCard(item);
    container.appendChild(card);
  });
}

// 初始化每日学习页面
function initDailyPage() {
  prepareAllItems();
  const sentenceBox = document.getElementById('daily-sentence');
  const phraseBox = document.getElementById('daily-phrase');
  const wordBox = document.getElementById('daily-word');
  const shuffleBtn = document.getElementById('shuffle-btn');
  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function showRandom() {
    // 句子
    const sentencesArr = window.dailySentences || [];
    const sItemRaw = pickRandom(sentencesArr);
    const sIndex = sentencesArr.indexOf(sItemRaw);
    const sId = 'ds-' + (sIndex + 1);
    const sItem = Object.assign({}, sItemRaw, { id: sId, category: 'dailySentence', scenario: 'Daily Sentence' });
    sentenceBox.innerHTML = '';
    sentenceBox.appendChild(createCard(sItem));
    // 短语
    const phrasesArr = window.dailyPhrases || [];
    const pItemRaw = pickRandom(phrasesArr);
    const pIndex = phrasesArr.indexOf(pItemRaw);
    const pId = 'dp-' + (pIndex + 1);
    const pItem = Object.assign({}, pItemRaw, { id: pId, category: 'dailyPhrase', scenario: 'Daily Phrase' });
    phraseBox.innerHTML = '';
    phraseBox.appendChild(createCard(pItem));
    // 单词
    const wordsArr = window.dailyWords || [];
    const wItemRaw = pickRandom(wordsArr);
    const wIndex = wordsArr.indexOf(wItemRaw);
    const wId = 'dw-' + (wIndex + 1);
    const wItem = Object.assign({}, wItemRaw, { id: wId, category: 'dailyWord', scenario: 'Daily Word' });
    wordBox.innerHTML = '';
    wordBox.appendChild(createCard(wItem));
  }
  shuffleBtn.addEventListener('click', () => {
    showRandom();
  });
  showRandom();
  // 设置重新渲染函数用于收藏/复习
  window.currentPageRender = showRandom;
}

// 初始化幼儿园页面
function initChildcarePage() {
  prepareAllItems();
  const container = document.getElementById('childcare-container');
  function renderPage() {
    renderList(container, window.childcareData || []);
  }
  window.currentPageRender = renderPage;
  renderPage();

  // No debug info in production
}

// 初始化护理页面
function initNursingPage() {
  prepareAllItems();
  const container = document.getElementById('nursing-container');
  function renderPage() {
    renderList(container, window.nursingData || []);
  }
  window.currentPageRender = renderPage;
  renderPage();
}

// 初始化澳洲生活页面
function initLifePage() {
  prepareAllItems();
  const container = document.getElementById('life-container');
  function renderPage() {
    renderList(container, window.lifeData || []);
  }
  window.currentPageRender = renderPage;
  renderPage();
}

// Initialize vocabulary page
function initVocabularyPage() {
  prepareAllItems();
  const container = document.getElementById('vocab-container');
  function renderPage() {
    renderList(container, window.vocabData || []);
  }
  window.currentPageRender = renderPage;
  renderPage();
}

// Initialize task settings page: allow users to configure daily plan targets
function initSettingsPage() {
  const form = document.getElementById('task-settings-form');
  if (!form) return;
  // Populate form with current settings
  const settings = loadPlanSettings();
  const childcareInput = document.getElementById('setting-childcare');
  const nursingInput = document.getElementById('setting-nursing');
  const australianInput = document.getElementById('setting-australian');
  const vocabInput = document.getElementById('setting-vocab');
  if (childcareInput) childcareInput.value = settings.childcare;
  if (nursingInput) nursingInput.value = settings.nursing;
  if (australianInput) australianInput.value = settings.australian;
  if (vocabInput) vocabInput.value = settings.vocab;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const newSettings = {
      childcare: parseInt(childcareInput.value, 10) || 0,
      nursing: parseInt(nursingInput.value, 10) || 0,
      australian: parseInt(australianInput.value, 10) || 0,
      vocab: parseInt(vocabInput.value, 10) || 0
    };
    savePlanSettings(newSettings);
    // reset today's tasks so new settings take effect
    localStorage.removeItem(PLAN_TASK_KEY);
    generatePlanTasks();
    updatePlanUI();
    updateStatsUI();
    alert('Settings saved!');
  });
}

// 初始化收藏页面
function initFavoritesPage() {
  prepareAllItems();
  const container = document.getElementById('favorites-container');
  function renderPage() {
    const favIds = loadFavorites();
    const items = favIds.map(id => getItemById(id)).filter(item => item !== null);
    // 如果没有收藏，显示提示
    container.innerHTML = '';
    if (items.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No favorites yet.';
      container.appendChild(p);
    } else {
      items.forEach(item => {
        container.appendChild(createCard(item));
      });
    }
  }
  window.currentPageRender = renderPage;
  renderPage();
}

// 初始化复习中心
function initReviewPage() {
  prepareAllItems();
  const todayList = document.getElementById('review-today-list');
  const upcomingList = document.getElementById('review-upcoming-list');
  const masteredList = document.getElementById('review-mastered-list');
  const statsDiv = document.getElementById('review-stats');
  function renderPage() {
    const reviews = loadReviews();
    // 初始化数组
    const todayArr = [];
    const upcomingArr = [];
    const masteredArr = [];
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    // 统计
    Object.keys(reviews).forEach(id => {
      const record = reviews[id];
      const item = getItemById(id);
      if (!item) return;
      if (record.stage >= reviewSchedule.length) {
        masteredArr.push({ item, record });
      } else if (record.nextReview <= todayDate.getTime()) {
        todayArr.push({ item, record });
      } else {
        upcomingArr.push({ item, record });
      }
    });
    // 按日期排序未来复习
    upcomingArr.sort((a, b) => a.record.nextReview - b.record.nextReview);
    // 渲染列表
    todayList.innerHTML = '';
    if (todayArr.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No reviews today.';
      todayList.appendChild(p);
    } else {
      todayArr.forEach(({ item }) => {
        todayList.appendChild(createCard(item));
      });
    }
    upcomingList.innerHTML = '';
    if (upcomingArr.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No upcoming reviews.';
      upcomingList.appendChild(p);
    } else {
      upcomingArr.forEach(({ item, record }) => {
        const card = createCard(item);
        upcomingList.appendChild(card);
      });
    }
    masteredList.innerHTML = '';
    if (masteredArr.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No mastered items yet.';
      masteredList.appendChild(p);
    } else {
      masteredArr.forEach(({ item }) => {
        const card = createCard(item);
        masteredList.appendChild(card);
      });
    }
    // 学习统计
    const ccLen = Array.isArray(window.childcareData) ? window.childcareData.length : 0;
    const nLen = Array.isArray(window.nursingData) ? window.nursingData.length : 0;
    const lLen = Array.isArray(window.lifeData) ? window.lifeData.length : 0;
    const dsLen = Array.isArray(window.dailySentences) ? window.dailySentences.length : 0;
    const dpLen = Array.isArray(window.dailyPhrases) ? window.dailyPhrases.length : 0;
    const dwLen = Array.isArray(window.dailyWords) ? window.dailyWords.length : 0;
    const totalCount = ccLen + nLen + lLen + dsLen + dpLen + dwLen;
    const favCount = loadFavorites().length;
    const masteredCount = masteredArr.length;
    // Review items count includes today and upcoming (items not yet mastered)
    const reviewCount = todayArr.length + upcomingArr.length;
    const diffCount = loadDifficult().length;
    const info = loadDailyInfo();
    const currentStreak = info.streak || 0;
    statsDiv.innerHTML = '';
    const statsList = [
      `Total Items: ${totalCount}`,
      `Favorites: ${favCount}`,
      `Review Items: ${reviewCount}`,
      `Mastered: ${masteredCount}`,
      `Difficult Items: ${diffCount}`,
      `Current Streak: ${currentStreak}`
    ];
    statsList.forEach(text => {
      const p = document.createElement('p');
      p.textContent = text;
      statsDiv.appendChild(p);
    });
  }
  window.currentPageRender = renderPage;
  renderPage();
}

// 初始化搜索页面
function initSearchPage() {
  prepareAllItems();
  const inputEl = document.getElementById('search-input');
  const resultsContainer = document.getElementById('search-results');
  function doSearch(term) {
    const lowerTerm = term.trim().toLowerCase();
    if (!lowerTerm) {
      resultsContainer.innerHTML = '';
      return;
    }
    const matched = allItems.filter(item => {
      const en = item.english.toLowerCase();
      const zh = item.chinese;
      return en.includes(lowerTerm) || (zh && zh.includes(term));
    });
    resultsContainer.innerHTML = '';
    if (matched.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No results found.';
      resultsContainer.appendChild(p);
    } else {
      matched.forEach(item => {
        resultsContainer.appendChild(createCard(item));
      });
    }
  }
  inputEl.addEventListener('input', (e) => {
    doSearch(e.target.value);
  });
  // 初始化为空
  doSearch('');
  // 在搜索结果页面，更新收藏或复习状态后保持当前搜索结果
  window.currentPageRender = () => {
    doSearch(inputEl.value);
  };
}

// 初始化快速添加页面
function initQuickAddPage() {
  prepareAllItems();
  const form = document.getElementById('quick-add-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const eng = document.getElementById('qa-english').value.trim();
    const cn = document.getElementById('qa-chinese').value.trim();
    const category = document.getElementById('qa-category').value;
    // Notes field may be absent in simplified quick add form
    const notesElem = document.getElementById('qa-notes');
    const notes = notesElem ? notesElem.value.trim() : '';
    if (!eng || !cn) {
      alert('Please enter both English and Chinese.');
      return;
    }
    const id = 'custom-' + Date.now();
    const newItem = {
      id,
      english: eng,
      chinese: cn,
      scenario: notes || 'Custom',
      category
    };
    // 存入本地数组（根据类别）
    // Append the new item to the appropriate category dataset
    if (category === 'childcare') {
      window.childcareData.push(newItem);
    } else if (category === 'nursing') {
      window.nursingData.push(newItem);
    } else if (category === 'australian') {
      window.lifeData.push(newItem);
    } else if (category === 'vocab') {
      if (!Array.isArray(window.vocabData)) window.vocabData = [];
      window.vocabData.push(newItem);
    }
    // 保存到自定义存储
    try {
      const arr = JSON.parse(localStorage.getItem('efra_custom') || '[]');
      arr.push(newItem);
      localStorage.setItem('efra_custom', JSON.stringify(arr));
    } catch (err) {
      console.error('Failed to save custom item:', err);
    }
    // 重建 allItems
    allItems = [];
    itemsMap = {};
    prepareAllItems();
    // 清空表单
    form.reset();
    // Reset today's plan so the new item can be scheduled immediately
    localStorage.removeItem(PLAN_TASK_KEY);
    generatePlanTasks();
    updatePlanUI();
    updateStatsUI();
    alert('Saved!');
  });
}

// 初始化智能添加页面
function initSmartAddPage() {
  prepareAllItems();
  const generateBtn = document.getElementById('sa-generate');
  if (generateBtn) {
    generateBtn.addEventListener('click', () => {
      const eng = document.getElementById('sa-english').value.trim();
      if (!eng) {
        alert('Please enter English first.');
        return;
      }
      // 简单的自动填充逻辑：示例和翻译直接引用输入
      document.getElementById('sa-example').value = eng;
      document.getElementById('sa-example-translation').value = '';
      document.getElementById('sa-chinese').value = '';
      document.getElementById('sa-scenario').value = '';
    });
  }
  const form = document.getElementById('smart-add-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const eng = document.getElementById('sa-english').value.trim();
      const cn = document.getElementById('sa-chinese').value.trim();
      const scenario = document.getElementById('sa-scenario').value.trim();
      const example = document.getElementById('sa-example').value.trim();
      const exampleCn = document.getElementById('sa-example-translation').value.trim();
      const category = document.getElementById('sa-category').value;
      if (!eng) {
        alert('Please enter English.');
        return;
      }
      const id = 'custom-' + Date.now();
      const newItem = {
        id,
        english: eng,
        chinese: cn || eng,
        scenario: scenario || 'Custom',
        category,
        example: example || eng,
        exampleChinese: exampleCn || cn || eng
      };
      // 添加到对应数组
      if (category === 'childcare') {
        window.childcareData.push(newItem);
      } else if (category === 'nursing') {
        window.nursingData.push(newItem);
      } else if (category === 'life') {
        window.lifeData.push(newItem);
      } else if (category === 'daily') {
        if (!window.dailyPhrases) window.dailyPhrases = [];
        window.dailyPhrases.push({ english: eng, chinese: cn || eng });
      }
      try {
        const arr = JSON.parse(localStorage.getItem('efra_custom') || '[]');
        arr.push(newItem);
        localStorage.setItem('efra_custom', JSON.stringify(arr));
      } catch (err) {
        console.error('Failed to save custom item:', err);
      }
      allItems = [];
      itemsMap = {};
      prepareAllItems();
      form.reset();
      alert('Saved!');
    });
  }
}

// 初始化难题本页面
function initDifficultPage() {
  prepareAllItems();
  const container = document.getElementById('difficult-container');
  function render() {
    const items = getDifficultItems();
    container.innerHTML = '';
    if (!items || items.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No difficult items yet.';
      container.appendChild(p);
      return;
    }
    items.forEach(item => {
      container.appendChild(createCard(item));
    });
  }
  window.currentPageRender = render;
  render();
}

// 主入口，根据页面类型初始化对应功能
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  // 确认 body 上的 data-page 属性
  const page = document.body.dataset.page;
  switch (page) {
    case 'childcare':
      initChildcarePage();
      break;
    case 'nursing':
      initNursingPage();
      break;
    case 'life':
      initLifePage();
      break;
    case 'review':
      initReviewPage();
      break;
    case 'search':
      initSearchPage();
      break;
    case 'quickadd':
      initQuickAddPage();
      break;
    case 'vocabulary':
      initVocabularyPage();
      break;
    case 'settings':
      initSettingsPage();
      break;
    case 'favorites':
      initFavoritesPage();
      break;
    case 'difficult':
      initDifficultPage();
      break;
    default:
      // 首页
      break;
  }

  // 注册 service worker（PWA）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.error('Service Worker registration failed:', err);
    });
  }

  // 初始化语音列表和选择器
  if (typeof speechSynthesis !== 'undefined') {
    updateVoiceList();
    // 某些浏览器需要延时才能获取到完整语音列表
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = updateVoiceList;
    }
  }
  // 设置语音下拉选项值
  const voiceSelectEl = document.getElementById('voice-select');
  if (voiceSelectEl) {
    // 设置默认选中
    voiceSelectEl.value = selectedVoiceCode;
    voiceSelectEl.addEventListener('change', (e) => {
      selectedVoiceCode = e.target.value;
      // 保存设置
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('efra_voice', selectedVoiceCode);
      }
      updateSelectedVoice();
    });
  }

  // 每日任务初始化及 UI 更新（仅首页相关）
  // Initialise daily plan and statistics for the home page
  updatePlanUI();
  updateStatsUI();

  // Start today's study mode when the button is clicked
  const startBtn = document.getElementById('start-today-btn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      startTodayStudyPlan();
    });
  }

  // 如果 beforeinstallprompt 事件先于 DOM 加载触发，此处检查以显示安装按钮
  if (window.deferredPrompt) {
    const installBtn = document.getElementById('install-button');
    if (installBtn) {
      installBtn.style.display = 'inline-block';
      // 确保只绑定一次点击事件
      installBtn.addEventListener('click', () => {
        installBtn.style.display = 'none';
        window.deferredPrompt.prompt();
        window.deferredPrompt.userChoice.then(() => {
          window.deferredPrompt = null;
        });
      }, { once: true });
    }
  }
});

// 捕获安装提示事件：存储事件并显示安装按钮
window.addEventListener('beforeinstallprompt', (e) => {
  // 防止自动显示提示
  e.preventDefault();
  // 将事件存储在全局变量以便稍后触发
  window.deferredPrompt = e;
  // 尝试显示安装按钮（如果 DOM 已经存在）
  const installBtn = document.getElementById('install-button');
  if (installBtn) {
    installBtn.style.display = 'inline-block';
    installBtn.addEventListener('click', () => {
      installBtn.style.display = 'none';
      window.deferredPrompt.prompt();
      window.deferredPrompt.userChoice.then(() => {
        window.deferredPrompt = null;
      });
    }, { once: true });
  }
});