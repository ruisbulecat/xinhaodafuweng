/* ============================================================
   信奥大富翁 · 数据层
   棋盘、章节、算法建筑、机惨事件卡、公告、成就、AI 选手
   ============================================================ */
(function (OI) {
  'use strict';

  const CONFIG = {
    startTokens: 20000,
    salary: 3000,
    jailFine: 4000,
    jailTurns: 3,
    maxAlgos: 4,
    buildRatio: 0.5,
    buildCostMults: [1, 1.25, 1.5, 1.8],
    sellRatio: 0.5,
    machineCrashPay: 600,
    mortgageRatio: 0.5,
    redeemRatio: 0.55,
    facilityPrice: 3500,
    facilityRentBase: 120,
    maxRounds: 25
  };

  const HUMAN_COLOR = '#4ff0c0';

  const AI_PLAYERS = [
    {
      id: 'ai-1', name: '卷王·阿珂', icon: '🦊', initial: '卷', color: '#6cb6ff',
      tag: '卷王', style: 'aggressive',
      ai: { buy: 0.92, build: 0.86, reserve: 0.1, jailPay: 0.55 }
    },
    {
      id: 'ai-2', name: '摸鱼·老陈', icon: '🐟', initial: '摸', color: '#f0c979',
      tag: '摸鱼', style: 'conservative',
      ai: { buy: 0.58, build: 0.45, reserve: 0.28, jailPay: 0.2 }
    },
    {
      id: 'ai-3', name: '玄学·小七', icon: '🎲', initial: '玄', color: '#ff8fa3',
      tag: '玄学', style: 'chaotic',
      ai: { buy: 0.74, build: 0.64, reserve: 0.16, jailPay: 0.38 }
    }
  ];

  const DIFFICULTIES = {
    easy: { id: 'easy', name: '摸鱼局', start: 26000, aiFactor: 0.8, note: 'AI 出手更保守，起始 token 更多。' },
    normal: { id: 'normal', name: '常规赛', start: 20000, aiFactor: 1, note: '标准对局。' },
    hard: { id: 'hard', name: '省选', start: 16000, aiFactor: 1.18, note: 'AI 更爱抢地，起始 token 更少。' }
  };

  const GROUPS = {
    basics: {
      id: 'basics', name: '入门基础', en: 'FOUNDATIONS', color: '#57d68d', chapter: '01',
      blurb: '一切算法开始的地方。'
    },
    struct: {
      id: 'struct', name: '数据结构', en: 'DATA STRUCTURES', color: '#4cc3ff', chapter: '02',
      blurb: '把数据摆成你想要的样子。'
    },
    sort: {
      id: 'sort', name: '排序查找', en: 'SORT & SEARCH', color: '#9b8cff', chapter: '03',
      blurb: '有序，是世界温柔的前提。'
    },
    search: {
      id: 'search', name: '搜索', en: 'SEARCH', color: '#ffd166', chapter: '04',
      blurb: '在解空间里，找到那一条路。'
    },
    graph: {
      id: 'graph', name: '图论', en: 'GRAPH THEORY', color: '#ff7b72', chapter: '05',
      blurb: '点与边之间，藏着无数条捷径。'
    },
    advanced: {
      id: 'advanced', name: '进阶结构', en: 'ADVANCED', color: '#f78fb3', chapter: '06',
      blurb: '省选选手的军火库。'
    },
    dp: {
      id: 'dp', name: '动态规划', en: 'DYNAMIC PROGRAMMING', color: '#ff9e64', chapter: '07',
      blurb: '状态定义对了，题就做完了一半。'
    },
    math: {
      id: 'math', name: '数学与字符串', en: 'MATH & STRINGS', color: '#34d3c4', chapter: '08',
      blurb: '最后的黑暗，也是最高的分。'
    }
  };

  const GROUP_ORDER = ['basics', 'struct', 'sort', 'search', 'graph', 'advanced', 'dp', 'math'];

  /* 每个章节的算法池；地块按章节内顺序轮流取 4 个作为“算法建筑” */
  const GROUP_POOL = {
    basics: [
      ['前缀和', '前缀'], ['差分', '差分'], ['双指针', '双针'], ['打表', '打表'], ['递推', '递推'], ['贪心', '贪心']
    ],
    struct: [
      ['单调栈', '单栈'], ['优先队列', '优队'], ['哈希表', '哈希'], ['ST 表', 'ST'], ['双端队列', '双端'], ['二叉堆', '堆']
    ],
    sort: [
      ['归并排序', '归并'], ['离散化', '离散'], ['二分答案', '二分'], ['三分', '三分'], ['基数排序', '基数'], ['快速排序', '快排']
    ],
    search: [
      ['记忆化', '记忆'], ['迭代加深', '迭代'], ['剪枝', '剪枝'], ['状压搜索', '状压'], ['折半搜索', '折半'], ['A*', 'A*']
    ],
    graph: [
      ['Dijkstra', 'DIJ'], ['Tarjan', 'TAR'], ['倍增 LCA', 'LCA'], ['缩点', '缩点'], ['拓扑 DP', '拓DP'], ['差分约束', '差约']
    ],
    advanced: [
      ['懒标记', '懒标'], ['树链剖分', '树剖'], ['可持久化', '可持'], ['分块', '分块'], ['莫队', '莫队'], ['点分治', '点分']
    ],
    dp: [
      ['滚动数组', '滚动'], ['单调队列', '单队'], ['斜率优化', '斜率'], ['状压 DP', '状压'], ['数位 DP', '数位'], ['矩阵快速幂', '矩快']
    ],
    math: [
      ['快速幂', '快幂'], ['逆元', '逆元'], ['KMP', 'KMP'], ['Manacher', 'MAN'], ['exgcd', 'exgcd'], ['容斥', '容斥']
    ]
  };

  const BOARD = [
    {
      id: 0, type: 'go', name: 'AK 起点', code: 'GO', icon: '🏁',
      desc: '每次经过领取 3,000 token。token 就是钱，从买下第一块地开始。'
    },
    {
      id: 1, type: 'property', group: 'basics', name: '输入输出', code: 'P1001', en: 'I/O', price: 1200,
      desc: '一切伟大算法的起点，也是 90% 的 WA 来源。'
    },
    {
      id: 2, type: 'chance', name: '随机事件', code: 'RNG', icon: '🎲',
      desc: '机惨、断电、写暴力被抓，赛场上什么都可能发生。'
    },
    {
      id: 3, type: 'property', group: 'basics', name: '模拟', code: 'P1002', en: 'SIMULATION', price: 1400,
      desc: '照着题意写，照着数据调。'
    },
    {
      id: 4, type: 'tax', name: '罚时结算', code: 'TLE', icon: '⏱', amount: 2000,
      desc: '评测超时，按分钟计费。2,000 token 进入罚时池。'
    },
    {
      id: 5, type: 'facility', name: '机房', code: 'F01', icon: '🖥', price: 3500,
      desc: '所有算法开始跑测试的地方。持有的算力设施越多，过路费越高。'
    },
    {
      id: 6, type: 'property', group: 'basics', name: '枚举', code: 'P1003', en: 'ENUMERATION', price: 1600,
      desc: '暴力出奇迹，枚举出真知。'
    },
    {
      id: 7, type: 'chest', name: 'OJ 公告', code: 'OJ', icon: '📢',
      desc: '公告栏里通常只有坏消息，以及更坏的消息。'
    },
    {
      id: 8, type: 'property', group: 'struct', name: '栈', code: 'P1004', en: 'STACK', price: 2000,
      desc: '后进先出，像极了考完试忘掉的知识。'
    },
    {
      id: 9, type: 'property', group: 'struct', name: '队列', code: 'P1005', en: 'QUEUE', price: 2200,
      desc: '先进先出，评测机排队也一样。'
    },
    {
      id: 10, type: 'jail', name: '禁赛区', code: 'BAN', icon: '🚫',
      desc: '写暴力（brute force）被裁判抓包。交罚金、用申诉信，或者掷出双数申诉离开。'
    },
    {
      id: 11, type: 'property', group: 'struct', name: '链表', code: 'P1006', en: 'LINKED LIST', price: 2400,
      desc: '指针一歪，内存就飞。'
    },
    {
      id: 12, type: 'facility', name: '评测机', code: 'F02', icon: '⚙️', price: 3500,
      desc: '你的代码和你的运气，都要在这里排队。'
    },
    {
      id: 13, type: 'property', group: 'sort', name: '排序', code: 'P1007', en: 'SORTING', price: 2800,
      desc: 'O(n log n) 是尊严，sort 是本能。'
    },
    {
      id: 14, type: 'property', group: 'sort', name: '二分', code: 'P1008', en: 'BINARY SEARCH', price: 3000,
      desc: '答案具有单调性时，世界会温柔一点。'
    },
    {
      id: 15, type: 'chest', name: 'OJ 公告', code: 'OJ', icon: '📢',
      desc: '公告栏里通常只有坏消息，以及更坏的消息。'
    },
    {
      id: 16, type: 'property', group: 'sort', name: '前缀和', code: 'P1009', en: 'PREFIX SUM', price: 3200,
      desc: '把 O(n) 的询问压成 O(1) 的快乐。'
    },
    {
      id: 17, type: 'chance', name: '随机事件', code: 'RNG', icon: '🎲',
      desc: '赛场上什么都可能发生，尤其是你没想到的那一种。'
    },
    {
      id: 18, type: 'property', group: 'search', name: 'DFS', code: 'P1010', en: 'DEPTH-FIRST', price: 3600,
      desc: '一条路走到黑，然后回溯。'
    },
    {
      id: 19, type: 'property', group: 'search', name: '剪枝', code: 'P1011', en: 'PRUNING', price: 3800,
      desc: '剪得好叫优化，剪不好叫玄学。'
    },
    {
      id: 20, type: 'parking', name: 'AK 休息室', code: 'REST', icon: '☕',
      desc: '罚时池里的 token 都在这儿。停在这里可以全部拿走，拿去建楼。'
    },
    {
      id: 21, type: 'property', group: 'search', name: 'BFS', code: 'P1012', en: 'BREADTH-FIRST', price: 4000,
      desc: '层层逼近，像教练查寝。'
    },
    {
      id: 22, type: 'tax', name: '内存超限', code: 'MLE', icon: '💾', amount: 1500,
      desc: '数组开太大，赔点 token 冷静一下。'
    },
    {
      id: 23, type: 'property', group: 'graph', name: '最短路', code: 'P1013', en: 'SHORTEST PATH', price: 4400,
      desc: 'Dijkstra 只对非负边负责。'
    },
    {
      id: 24, type: 'property', group: 'graph', name: '最小生成树', code: 'P1014', en: 'SPANNING TREE', price: 4600,
      desc: '让所有点连通，代价最小。'
    },
    {
      id: 25, type: 'facility', name: '集群', code: 'F03', icon: '🗄', price: 3500,
      desc: '一整个机柜的算力，只为你一个人的 TLE 服务。'
    },
    {
      id: 26, type: 'property', group: 'graph', name: '拓扑排序', code: 'P1015', en: 'TOPOSORT', price: 4800,
      desc: '有环的依赖关系，就该报错。'
    },
    {
      id: 27, type: 'property', group: 'advanced', name: '线段树', code: 'P1016', en: 'SEGMENT TREE', price: 5200,
      desc: '一棵树管一个区间，懒标记管人生。'
    },
    {
      id: 28, type: 'chest', name: 'OJ 公告', code: 'OJ', icon: '📢',
      desc: '公告栏里通常只有坏消息，以及更坏的消息。'
    },
    {
      id: 29, type: 'property', group: 'advanced', name: '树状数组', code: 'P1017', en: 'FENWICK TREE', price: 5400,
      desc: 'lowbit 是世界上最优雅的东西。'
    },
    {
      id: 30, type: 'goToJail', name: '暴力检查', code: 'BF!', icon: '🚔',
      desc: '裁判抽查代码，看到你的三重循环摇了摇头。直接送进禁赛区。'
    },
    {
      id: 31, type: 'property', group: 'advanced', name: '并查集', code: 'P1018', en: 'UNION-FIND', price: 5600,
      desc: '路径压缩之后，我们都是一家人。'
    },
    {
      id: 32, type: 'property', group: 'dp', name: '背包', code: 'P1019', en: 'KNAPSACK', price: 6000,
      desc: '容量有限，欲望无限。'
    },
    {
      id: 33, type: 'chance', name: '随机事件', code: 'RNG', icon: '🎲',
      desc: '赛场上什么都可能发生，尤其是你没想到的那一种。'
    },
    {
      id: 34, type: 'property', group: 'dp', name: '区间 DP', code: 'P1020', en: 'INTERVAL DP', price: 6200,
      desc: '先枚举断点，再相信状态转移。'
    },
    {
      id: 35, type: 'facility', name: '超算', code: 'F04', icon: '🚀', price: 3500,
      desc: '传闻中永远不会 TLE 的机器。只是传闻。'
    },
    {
      id: 36, type: 'property', group: 'dp', name: '树形 DP', code: 'P1021', en: 'TREE DP', price: 6400,
      desc: '父亲的选择，决定了儿子的命运。'
    },
    {
      id: 37, type: 'property', group: 'math', name: '数论', code: 'P1022', en: 'NUMBER THEORY', price: 7000,
      desc: 'gcd 之外，还有更深的黑暗。'
    },
    {
      id: 38, type: 'property', group: 'math', name: '组合数学', code: 'P1023', en: 'COMBINATORICS', price: 7200,
      desc: '答案先取模，人生不能。'
    },
    {
      id: 39, type: 'property', group: 'math', name: '字符串哈希', code: 'P1024', en: 'STRING HASH', price: 7400,
      desc: '九成九的把握，和 1% 的冲突。'
    }
  ];

  const CHANCE = [
    {
      id: 'c01', icon: '⚡', tone: 'good', title: '卡常成功',
      text: '你把 10⁹ 次循环压进了 1 秒。其他所有选手各付你 600 token 学习常数优化。',
      effect: { type: 'collectEach', amount: 600 }
    },
    {
      id: 'c02', icon: '💥', tone: 'bad', title: '暴力被查重',
      text: '你交了一发 O(n²) 暴力，被查重系统标记为“恶意卡评测”。裁判把你请进了禁赛区。',
      effect: { type: 'jail', reason: '写暴力（O(n²)）被查重系统标记' }
    },
    {
      id: 'c03', icon: '🧪', tone: 'bad', title: '数据加强',
      text: '出题人连夜加了 20 组菊花图。重造数据，支付 1,500 token。',
      effect: { type: 'pay', amount: 1500 }
    },
    {
      id: 'c04', icon: '📄', tone: 'good', title: '发现原题',
      text: '这道题你在三年前做过。免费在随机自有地块加盖 1 层算法建筑。',
      effect: { type: 'freeBuild' }
    },
    {
      id: 'c05', icon: '💀', tone: 'bad', title: '手滑 rm -rf',
      text: '你本想删除 a.out，却删掉了整个文件夹。损失 1,200 token。',
      effect: { type: 'pay', amount: 1200 }
    },
    {
      id: 'c06', icon: '🎲', tone: 'good', title: '玄学 AC',
      text: '样例全过，大样例全过，你也不知道为什么。掷骰子，点数 × 300 token。',
      effect: { type: 'diceGain', mult: 300 }
    },
    {
      id: 'c07', icon: '🏁', tone: 'good', title: '省选晋级',
      text: '你拿到了省队名额。回到 AK 起点，领取 3,000 token。',
      effect: { type: 'moveTo', index: 0, salary: true }
    },
    {
      id: 'c08', icon: '🕵️', tone: 'bad', title: '被 hack',
      text: '你的哈希被构造数据卡了。向随机一名对手支付 800 token 封口费。',
      effect: { type: 'payRival', amount: 800 }
    },
    {
      id: 'c09', icon: '🔌', tone: 'bad', title: '机房跳闸',
      text: '整层楼停电，你最后一个提交的代码没保存。支付 800 token 重写。',
      effect: { type: 'pay', amount: 800 }
    },
    {
      id: 'c10', icon: '🧋', tone: 'good', title: '教练请奶茶',
      text: '教练心情不错，给全队点了奶茶。获得 600 token。',
      effect: { type: 'gain', amount: 600 }
    },
    {
      id: 'c11', icon: '📚', tone: 'good', title: '题解被抄',
      text: '你的题解被转发了 300 次。获得 1,000 token 打赏。',
      effect: { type: 'gain', amount: 1000 }
    },
    {
      id: 'c12', icon: '🛠', tone: 'bad', title: '编译器抽风',
      text: '本地 AC，提交 CE。折腾一晚上，支付 700 token。',
      effect: { type: 'pay', amount: 700 }
    },
    {
      id: 'c13', icon: '📜', tone: 'good', title: '免费申诉',
      text: '教练替你写好了申诉信。获得一张「申诉信」，可立即离开禁赛区。',
      effect: { type: 'getOut' }
    },
    {
      id: 'c14', icon: '🎯', tone: 'bad', title: '被出题人针对',
      text: '你的 ID 出现在出题人的小本本上，理由是“一看就在写暴力”。直接进入禁赛区。',
      effect: { type: 'jail', reason: '被出题人举报写暴力' }
    },
    {
      id: 'c15', icon: '⏳', tone: 'bad', title: '评测机排队',
      text: '前面还有 4,000 份提交。支付 400 token 买优先评测。',
      effect: { type: 'pay', amount: 400 }
    },
    {
      id: 'c16', icon: '🚌', tone: 'neutral', title: '省队集训',
      text: '大巴来了，所有人上车。前进 3 格。',
      effect: { type: 'moveBy', steps: 3 }
    },
    {
      id: 'c17', icon: '🖋', tone: 'good', title: '成为出题人',
      text: '你的题进了省选题库。随机章节租金上涨 30%，持续 8 回合。',
      effect: { type: 'market', mult: 1.3, rounds: 8 }
    },
    {
      id: 'c18', icon: '📋', tone: 'bad', title: '大纲改动',
      text: '新大纲删掉了一个章节。随机章节租金下跌 20%，持续 8 回合。',
      effect: { type: 'market', mult: 0.8, rounds: 8 }
    },
    {
      id: 'c19', icon: '🔌', tone: 'bad', title: '机惨 · 机房断电',
      text: '整层楼突然断电，所有选手的算法建筑随机短路 1 层；没有建筑的选手赔偿 600 token 买保险。',
      effect: { type: 'machineCrash', amount: 600 }
    },
    {
      id: 'c20', icon: '💥', tone: 'bad', title: '暴力出奇迹',
      text: '你交了一发 O(n³) 暴力，居然 AC 了。裁判复核后认定恶意卡评测，直接禁赛。',
      effect: { type: 'jail', reason: '用 O(n³) 暴力恶意卡评测' }
    },
    {
      id: 'c21', icon: '💧', tone: 'bad', title: '空调漏水',
      text: '机柜上方的空调开始滴水，随机一栋算法建筑短路降 1 级；没有建筑则赔偿 800 token。',
      effect: { type: 'destroyBuild', fallback: 800 }
    },
    {
      id: 'c22', icon: '💽', tone: 'bad', title: '数据没备份',
      text: '你只把代码存在本地。硬盘异响之后，随机一栋算法建筑降 1 级；没有建筑则损失 1,000 token。',
      effect: { type: 'destroyBuild', fallback: 1000 }
    },
    {
      id: 'c23', icon: '🔋', tone: 'good', title: 'UPS 到货',
      text: '学校终于给机房装了 UPS。这次机惨没有波及你，还省下 800 token 电费。',
      effect: { type: 'gain', amount: 800 }
    },
    {
      id: 'c24', icon: '📄', tone: 'good', title: '机惨保险理赔',
      text: '你给算法建筑买了保险。按建筑层数 × 200 token 理赔。',
      effect: { type: 'gainPerBuild', amount: 200 }
    },
    {
      id: 'c25', icon: '🛠', tone: 'bad', title: '隔壁装修',
      text: '隔壁集训队开始装修，电钻精准命中你的插排。随机一栋算法建筑降 1 级；没有建筑则赔偿 700 token。',
      effect: { type: 'destroyBuild', fallback: 700 }
    }
  ];

  const CHEST = [
    {
      id: 'b01', icon: '🥇', tone: 'good', title: '一等奖',
      text: '你在省赛拿了一等奖。学校奖励 2,500 token。',
      effect: { type: 'gain', amount: 2500 }
    },
    {
      id: 'b02', icon: '🧾', tone: 'good', title: '学校报销',
      text: '差旅费终于报销下来了。获得 1,200 token。',
      effect: { type: 'gain', amount: 1200 }
    },
    {
      id: 'b03', icon: '⌨️', tone: 'bad', title: '机械键盘',
      text: '你买了一支 65% 配列的机械键盘。支付 800 token，手感 +100。',
      effect: { type: 'pay', amount: 800 }
    },
    {
      id: 'b04', icon: '🐞', tone: 'good', title: '帮同学调题',
      text: '你一眼看出他少开了一个 long long。获得 400 token 感谢费。',
      effect: { type: 'gain', amount: 400 }
    },
    {
      id: 'b05', icon: '📘', tone: 'good', title: '竞赛班资料',
      text: '学长把祖传模板打包发给了你。获得 600 token 等价资料。',
      effect: { type: 'gain', amount: 600 }
    },
    {
      id: 'b06', icon: '🖥', tone: 'good', title: '机房扩容',
      text: '学校又买了一排机器。随机章节租金上涨 20%，持续 8 回合。',
      effect: { type: 'market', mult: 1.2, rounds: 8 }
    },
    {
      id: 'b07', icon: '🎖', tone: 'good', title: '校队选拔通过',
      text: '你正式成为校队成员。获得 1,800 token 训练补贴。',
      effect: { type: 'gain', amount: 1800 }
    },
    {
      id: 'b08', icon: '🎗', tone: 'good', title: '退役仪式',
      text: '学长退役前把账号留给了你。获得 1,000 token。',
      effect: { type: 'gain', amount: 1000 }
    },
    {
      id: 'b09', icon: '📝', tone: 'bad', title: '忘交作业',
      text: '你连续三天没交文化课作业。支付 600 token 请课代表喝奶茶。',
      effect: { type: 'pay', amount: 600 }
    },
    {
      id: 'b10', icon: '💾', tone: 'bad', title: '借出 U 盘',
      text: 'U 盘借出去，回来时只剩一个快捷方式。支付 300 token。',
      effect: { type: 'pay', amount: 300 }
    },
    {
      id: 'b11', icon: '💰', tone: 'good', title: '出题费到账',
      text: '你出的模拟赛结算了。获得 1,500 token。',
      effect: { type: 'gain', amount: 1500 }
    },
    {
      id: 'b12', icon: '📱', tone: 'bad', title: '教练收手机',
      text: '晚自习玩手机被抓。支付 500 token 赎回。',
      effect: { type: 'pay', amount: 500 }
    },
    {
      id: 'b13', icon: '🔥', tone: 'good', title: '题解上首页',
      text: '你的题解被管理员置顶。获得 900 token 打赏。',
      effect: { type: 'gain', amount: 900 }
    },
    {
      id: 'b14', icon: '🧰', tone: 'good', title: '官方数据修复',
      text: '管理员修好了数据。免费在随机自有地块加盖 1 层算法建筑。',
      effect: { type: 'freeBuild' }
    },
    {
      id: 'b15', icon: '🎉', tone: 'good', title: '校庆放假',
      text: '全校放假一天，教练心情大好。获得一张「申诉信」。',
      effect: { type: 'getOut' }
    },
    {
      id: 'b16', icon: '🎓', tone: 'good', title: '奖学金',
      text: '你拿到了信息学特长奖学金。获得 2,000 token。',
      effect: { type: 'gain', amount: 2000 }
    },
    {
      id: 'b17', icon: '🧧', tone: 'good', title: '机惨慰问金',
      text: '你上个月刚经历机惨，教练发了慰问金。获得 900 token。',
      effect: { type: 'gain', amount: 900 }
    },
    {
      id: 'b18', icon: '🗃', tone: 'good', title: '代码已备份',
      text: '你养成了随手 git push 的习惯。免费在随机自有地块加盖 1 层算法建筑。',
      effect: { type: 'freeBuild' }
    },
    {
      id: 'b19', icon: '🏢', tone: 'good', title: '机房搬迁补助',
      text: '学校搬新机房，每层算法建筑补贴 150 token。',
      effect: { type: 'gainPerBuild', amount: 150 }
    }
  ];

  const NEWS = [
    { group: 'dp', mult: 1.3, text: 'CCF 更新大纲，动态规划权重上调，DP 区租金 +30%' },
    { group: 'dp', mult: 0.8, text: '出题人集体改行，动态规划题量缩水，DP 区租金 -20%' },
    { group: 'graph', mult: 1.25, text: '省选新增图论大题，图论区一夜升温，租金 +25%' },
    { group: 'graph', mult: 0.85, text: '最短路模板题泛滥，图论区租金 -15%' },
    { group: 'struct', mult: 1.3, text: '数据结构成为新宠，机房加练线段树，租金 +30%' },
    { group: 'struct', mult: 0.8, text: 'STL 大行其道，手写数据结构贬值，租金 -20%' },
    { group: 'basics', mult: 1.2, text: 'A+B 被列为必考题，入门区租金 +20%' },
    { group: 'basics', mult: 0.8, text: '基础题不再送分，入门区热度下降，租金 -20%' },
    { group: 'sort', mult: 1.25, text: '排序与二分被写进新大纲，租金 +25%' },
    { group: 'sort', mult: 0.85, text: 'sort 一把梭成为主流，排序区租金 -15%' },
    { group: 'search', mult: 1.3, text: '搜索题回归省选，DFS 区租金 +30%' },
    { group: 'search', mult: 0.8, text: '搜索剪枝被判玄学，搜索区租金 -20%' },
    { group: 'advanced', mult: 1.3, text: '树链剖分进入考纲，进阶结构区租金 +30%' },
    { group: 'advanced', mult: 0.85, text: '模板库被封，进阶结构区租金 -15%' },
    { group: 'math', mult: 1.25, text: '数论与组合重回压轴，数学区租金 +25%' },
    { group: 'math', mult: 0.8, text: '字符串哈希大规模冲突，数学区租金 -20%' }
  ];

  const ACHIEVEMENTS = [
    { id: 'first_buy', name: '第一块地', icon: '🏠', desc: '买下你的第一块算法地块。' },
    { id: 'builder', name: '基建狂魔', icon: '🧱', desc: '一局内累计建造 10 层算法建筑。' },
    { id: 'monopoly', name: '章节垄断', icon: '🗺', desc: '收齐任意一个章节的全部地块。' },
    { id: 'full_stack', name: '满配', icon: '✨', desc: '让一块地盖满 4 层算法建筑。' },
    { id: 'jailbreak', name: '申诉成功', icon: '⚖️', desc: '在禁赛区掷出双数并离开。' },
    { id: 'brute', name: '暴力分子', icon: '💥', desc: '因为写暴力被禁赛一次。' },
    { id: 'machine_crash', name: '机惨亲历者', icon: '🔌', desc: '亲历一次机房惨案。' },
    { id: 'cards', name: '事件体质', icon: '🃏', desc: '一局内抽到 5 张随机事件卡。' },
    { id: 'rich', name: 'token 富翁', icon: '💎', desc: '持有的 token 达到 50,000。' },
    { id: 'winner', name: 'AK 之王', icon: '👑', desc: '赢下一局比赛。' },
    { id: 'bankrupt', name: '光荣退役', icon: '☠️', desc: '在罚时与租金中破产。' },
    { id: 'comeback', name: '逆风翻盘', icon: '🔁', desc: 'token 曾低于 1,000，最后仍然夺冠。' }
  ];

  const DECK = { chance: CHANCE, chest: CHEST };

  /* ---------- 派生数据 ---------- */
  function roundTo(n, step) {
    return Math.round(n / step) * step;
  }

  const RENT_RATIO = [0.1, 0.25, 0.5, 0.85, 1.25];

  BOARD.forEach((tile) => {
    if (tile.type === 'property') {
      const group = GROUPS[tile.group];
      const order = BOARD.filter((t) => t.type === 'property' && t.group === tile.group).indexOf(tile);
      tile.groupName = group.name;
      tile.color = group.color;
      tile.rent = RENT_RATIO.map((r) => roundTo(tile.price * r, 10));
      tile.buildCost = roundTo(tile.price * CONFIG.buildRatio, 100);
      tile.buildCosts = CONFIG.buildCostMults.map((m) => roundTo(tile.buildCost * m, 100));
      tile.pool = GROUP_POOL[tile.group];
      tile.algoOffset = order * 1;
      tile.algoSet = [];
      for (let i = 0; i < CONFIG.maxAlgos; i++) {
        const pair = tile.pool[(tile.algoOffset + i) % tile.pool.length];
        tile.algoSet.push({ name: pair[0], short: pair[1] });
      }
    } else if (tile.type === 'facility') {
      tile.color = '#8aa39c';
      tile.rent = [0, 600, 1200, 2000, 3200];
    }
  });

  /* 棋盘坐标：右下角为起点，逆时针绕行 */
  BOARD.forEach((tile) => {
    const i = tile.id;
    if (i === 0) { tile.row = 11; tile.col = 11; tile.side = 'corner'; }
    else if (i < 10) { tile.row = 11; tile.col = 11 - i; tile.side = 'bottom'; }
    else if (i === 10) { tile.row = 11; tile.col = 1; tile.side = 'corner'; }
    else if (i < 20) { tile.row = 21 - i; tile.col = 1; tile.side = 'left'; }
    else if (i === 20) { tile.row = 1; tile.col = 1; tile.side = 'corner'; }
    else if (i < 30) { tile.row = 1; tile.col = i - 19; tile.side = 'top'; }
    else if (i === 30) { tile.row = 1; tile.col = 11; tile.side = 'corner'; }
    else { tile.row = i - 29; tile.col = 11; tile.side = 'right'; }
  });

  OI.DATA = {
    CONFIG,
    HUMAN_COLOR,
    AI_PLAYERS,
    DIFFICULTIES,
    GROUPS,
    GROUP_ORDER,
    GROUP_POOL,
    BOARD,
    CHANCE,
    CHEST,
    DECK,
    NEWS,
    ACHIEVEMENTS,
    STORAGE: {
      best: 'oiopoly.best',
      achievements: 'oiopoly.achievements',
      sound: 'oiopoly.sound',
      stats: 'oiopoly.stats'
    }
  };
})(window.OI = window.OI || {});
