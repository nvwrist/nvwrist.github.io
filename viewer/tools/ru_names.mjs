// Русские названия для моделей CC0-паков: английское имя файла → «Существительное (признаки)».
// Признаки даём существительными/сокращениями — так не нужно согласовывать род.

export const NOUNS = {
  wall: 'Стена', walls: 'Стены', floor: 'Пол', floors: 'Пол', roof: 'Крыша', roofs: 'Крыша', door: 'Дверь', doors: 'Дверь', doorway: 'Дверной проём',
  window: 'Окно', windows: 'Окна', stairs: 'Лестница', stair: 'Лестница', steps: 'Ступени', step: 'Ступень', ladder: 'Лестница-стремянка',
  tower: 'Башня', pillar: 'Колонна', column: 'Колонна', arch: 'Арка', gate: 'Ворота', battlement: 'Зубцы стены', bridge: 'Мост',
  house: 'Дом', building: 'Здание', home: 'Дом', chimney: 'Труба', balcony: 'Балкон', beam: 'Балка', planks: 'Доски', plank: 'Доска',
  ceiling: 'Потолок', overhang: 'Навес', structure: 'Конструкция', dock: 'Причал', foundation: 'Фундамент', mill: 'Мельница',
  windmill: 'Ветряная мельница', watermill: 'Водяная мельница', barn: 'Амбар', bigbarn: 'Большой амбар', openbarn: 'Навес-амбар',
  silo: 'Силос', well: 'Колодец', fence: 'Забор', railing: 'Перила', rail: 'Перила', hedge: 'Живая изгородь', pole: 'Столб', poles: 'Столбы',
  corridor: 'Коридор', room: 'Комната', template: 'Шаблон', trapdoor: 'Люк', trap: 'Ловушка', spikes: 'Шипы', cell: 'Камера',
  bars: 'Решётка', cage: 'Клетка', portcullis: 'Решётка ворот', drawbridge: 'Подъёмный мост', fortress: 'Крепость', castle: 'Замок',
  keep: 'Донжон', wallcover: 'Облицовка стены', cover: 'Облицовка', stall: 'Прилавок', market: 'Рынок', tent: 'Палатка', hut: 'Хижина',
  shack: 'Лачуга', cabin: 'Хижина', church: 'Церковь', chapel: 'Часовня', tavern: 'Таверна', inn: 'Трактир', blacksmith: 'Кузница',
  forge: 'Горн', smithy: 'Кузница', stable: 'Конюшня', castle_: 'Замок', fountain: 'Фонтан', statue: 'Статуя', road: 'Дорога', path: 'Тропа',
  tile: 'Плитка', tiles: 'Плитка', hex: 'Гекс', ground: 'Земля', platform: 'Платформа', block: 'Блок', bricks: 'Кирпичи', brick: 'Кирпич',
  shutters: 'Ставни', shutter: 'Ставня', frame: 'Рама', trim: 'Отделка', support: 'Опора', supports: 'Опоры', scaffold: 'Леса', scaffolding: 'Леса',
  pulley: 'Блок-подъёмник', crane: 'Кран', watchtower: 'Сторожевая башня', siege: 'Осадное орудие', catapult: 'Катапульта', trebuchet: 'Требушет',
  ballista: 'Баллиста', ram: 'Таран', wheel: 'Колесо', blade: 'Лопасть', water: 'Вода', waterfall: 'Водопад', lava: 'Лава',
  // природа
  tree: 'Дерево', trees: 'Деревья', commontree: 'Дерево', pinetree: 'Ель', pine: 'Ель', birchtree: 'Берёза', birch: 'Берёза', willow: 'Ива',
  palmtree: 'Пальма', palm: 'Пальма', oak: 'Дуб', deadtree: 'Сухое дерево', twistedtree: 'Кривое дерево', bush: 'Куст', bushes: 'Кусты',
  bushberries: 'Ягодный куст', shrub: 'Кустарник', rock: 'Камень', rocks: 'Камни', stone: 'Камень', stones: 'Камни', boulder: 'Валун',
  pebble: 'Галька', pebbles: 'Галька', grass: 'Трава', flower: 'Цветок', flowers: 'Цветы', plant: 'Растение', plants: 'Растения',
  mushroom: 'Гриб', mushrooms: 'Грибы', stump: 'Пень', treestump: 'Пень', log: 'Бревно', logs: 'Брёвна', woodlog: 'Бревно', cactus: 'Кактус',
  cactusflower: 'Цветущий кактус', cactusflowers: 'Цветущий кактус', leaf: 'Лист', leaves: 'Листва', lily: 'Лилия', lilypad: 'Кувшинка',
  wheat: 'Пшеница', corn: 'Кукуруза', crop: 'Посев', crops: 'Посевы', cliff: 'Скала', hill: 'Холм', hills: 'Холмы', fern: 'Папоротник',
  clover: 'Клевер', reed: 'Камыш', reeds: 'Камыш', vine: 'Лоза', vines: 'Лоза', ivy: 'Плющ', moss: 'Мох', root: 'Корень', roots: 'Корни',
  branch: 'Ветка', branches: 'Ветки', petal: 'Лепесток', petals: 'Лепестки', pathrocks: 'Камни тропы', tallgrass: 'Высокая трава',
  // быт
  barrel: 'Бочка', barrels: 'Бочки', crate: 'Ящик', crates: 'Ящики', box: 'Коробка', boxes: 'Коробки', chest: 'Сундук', table: 'Стол',
  chair: 'Стул', stool: 'Табурет', bench: 'Скамья', bed: 'Кровать', shelf: 'Полка', shelves: 'Полки', bookcase: 'Книжный шкаф',
  book: 'Книга', books: 'Книги', bottle: 'Бутылка', bottles: 'Бутылки', pot: 'Горшок', pots: 'Горшки', jar: 'Банка', bucket: 'Ведро',
  sack: 'Мешок', sacks: 'Мешки', bag: 'Сумка', cart: 'Телега', wagon: 'Повозка', anvil: 'Наковальня', workbench: 'Верстак',
  rug: 'Ковёр', carpet: 'Ковёр', cauldron: 'Котёл', vase: 'Ваза', plate: 'Тарелка', bowl: 'Миска', mug: 'Кружка', cup: 'Чашка',
  chalice: 'Чаша', goblet: 'Кубок', food: 'Еда', apple: 'Яблоко', apples: 'Яблоки', bread: 'Хлеб', cheese: 'Сыр', fish: 'Рыба',
  meat: 'Мясо', rope: 'Верёвка', ropes: 'Верёвки', sign: 'Вывеска', signpost: 'Указатель', banner: 'Знамя', flag: 'Флаг', hay: 'Сено',
  haybale: 'Тюк сена', firewood: 'Дрова', wood: 'Дерево', coin: 'Монета', coins: 'Монеты', gold: 'Золото', key: 'Ключ', keys: 'Ключи',
  potion: 'Зелье', potions: 'Зелья', scroll: 'Свиток', scrolls: 'Свитки', map: 'Карта', candlestick: 'Подсвечник', cabinet: 'Шкаф',
  wardrobe: 'Гардероб', drawer: 'Комод', dresser: 'Комод', desk: 'Письменный стол', throne: 'Трон', armchair: 'Кресло', couch: 'Диван',
  pillow: 'Подушка', blanket: 'Одеяло', bedroll: 'Спальник', mirror: 'Зеркало', painting: 'Картина', picture: 'Картина', clock: 'Часы',
  rack: 'Стойка', weaponstand: 'Оружейная стойка', stand: 'Подставка', dummy: 'Манекен', target: 'Мишень', tub: 'Кадка', trough: 'Корыто',
  basket: 'Корзина', baskets: 'Корзины', pumpkin: 'Тыква', pumpkins: 'Тыквы', carrot: 'Морковь', cabbage: 'Капуста', fruit: 'Фрукты',
  vegetable: 'Овощи', vegetables: 'Овощи', loaf: 'Буханка', pie: 'Пирог', jug: 'Кувшин', teapot: 'Чайник', kettle: 'Котелок', pan: 'Сковорода',
  ingot: 'Слиток', bar: 'Слиток', ore: 'Руда', gem: 'Самоцвет', gems: 'Самоцветы', crystal: 'Кристалл', crystals: 'Кристаллы', resource: 'Ресурс',
  tools: 'Инструменты', tool: 'Инструмент', hammer: 'Молот', pickaxe: 'Кирка', shovel: 'Лопата', hoe: 'Мотыга', saw: 'Пила', pitchfork: 'Вилы',
  sickle: 'Серп', scythe: 'Коса', chisel: 'Зубило', tongs: 'Клещи', wrench: 'Ключ', nail: 'Гвоздь', nails: 'Гвозди', blueprint: 'Чертёж',
  pencil: 'Карандаш', quill: 'Перо', ink: 'Чернила', inkwell: 'Чернильница', compass: 'Компас', telescope: 'Подзорная труба', lockpick: 'Отмычка',
  dice: 'Кости', cards: 'Карты', instrument: 'Инструмент', lute: 'Лютня', drum: 'Барабан', horn: 'Рог', bell: 'Колокол', chain: 'Цепь', chains: 'Цепи',
  hook: 'Крюк', bone: 'Кость', bones: 'Кости', skull: 'Череп', skulls: 'Черепа', ribcage: 'Рёбра', paper: 'Бумага', note: 'Записка',
  // свет
  torch: 'Факел', torches: 'Факелы', candle: 'Свеча', candles: 'Свечи', lantern: 'Фонарь', lamp: 'Лампа', lightpost: 'Фонарный столб',
  fire: 'Огонь', campfire: 'Костёр', woodfire: 'Костёр', brazier: 'Жаровня', firebasket: 'Жаровня', chandelier: 'Люстра', light: 'Свет',
  // мрак и кладбище
  grave: 'Могила', gravestone: 'Надгробие', gravemarker: 'Надгробие', tombstone: 'Надгробие', tomb: 'Гробница', crypt: 'Склеп',
  coffin: 'Гроб', cross: 'Крест', cobweb: 'Паутина', web: 'Паутина', altar: 'Алтарь', urn: 'Урна', obelisk: 'Обелиск', debris: 'Обломки',
  shrine: 'Святилище', idol: 'Идол', totem: 'Тотем', candelabra: 'Канделябр', scarecrow: 'Пугало', ghost: 'Призрак', zombie: 'Зомби',
  vampire: 'Вампир', keeper: 'Смотритель', witch: 'Ведьма', bat: 'Летучая мышь', spider: 'Паук', raven: 'Ворон', crow: 'Ворона',
  // оружие
  sword: 'Меч', swords: 'Мечи', shortsword: 'Короткий меч', katana: 'Катана', axe: 'Топор', axes: 'Топоры', bow: 'Лук', shield: 'Щит',
  dagger: 'Кинжал', spear: 'Копьё', mace: 'Булава', club: 'Дубина', staff: 'Посох', wand: 'Жезл', crossbow: 'Арбалет', arrow: 'Стрела',
  arrows: 'Стрелы', quiver: 'Колчан', halberd: 'Алебарда', helmet: 'Шлем', helmet1: 'Шлем', helmet2: 'Шлем', helmet3: 'Шлем',
  shoulderpads: 'Наплечники', armor: 'Доспех', armour: 'Доспех', spellbook: 'Книга заклинаний', smokebomb: 'Дымовая бомба', bomb: 'Бомба',
  weapon: 'Оружие', weapons: 'Оружие', sabre: 'Сабля', saber: 'Сабля', rapier: 'Рапира', flail: 'Цеп', whip: 'Кнут', blade_: 'Клинок',
  // существа
  character: 'Персонаж', knight: 'Рыцарь', knightcharacter: 'Рыцарь', mage: 'Маг', rogue: 'Разбойник', barbarian: 'Варвар', ranger: 'Следопыт',
  warrior: 'Воин', minion: 'Прислужник', skeleton: 'Скелет', human: 'Человек', orc: 'Орк', goblin: 'Гоблин', imp: 'Бес', puglin: 'Пуглин',
  dragon: 'Дракон', slime: 'Слизень', frog: 'Лягушка', rat: 'Крыса', snake: 'Змея', wasp: 'Оса', cow: 'Корова', horse: 'Лошадь',
  llama: 'Лама', pig: 'Свинья', pug: 'Мопс', sheep: 'Овца', zebra: 'Зебра', chicken: 'Курица', chickencoop: 'Курятник', dog: 'Собака',
  wolf: 'Волк', deer: 'Олень', bear: 'Медведь', fox: 'Лиса', mannequin: 'Манекен',
  // разное
  boat: 'Лодка', ship: 'Корабль', raft: 'Плот', anchor: 'Якорь', cannon: 'Пушка', wheelbarrow: 'Тачка', sled: 'Сани', sledge: 'Сани',
  watertower: 'Водонапорная башня', silo_house: 'Силос', towerwindmill: 'Мельница-башня', pedestal: 'Пьедестал', decorative: 'Декор',
  table_fork: 'Вилка', table_knife: 'Нож', table_spoon: 'Ложка', table_plate: 'Тарелка', table_cup: 'Чашка', fork: 'Вилка', knife: 'Нож', spoon: 'Ложка',
  farmcrate: 'Ящик с урожаем', bookstand: 'Подставка для книг', bookgroup: 'Книги', candlestick_stand: 'Подсвечник-стойка', shelf_arch: 'Полка с аркой',
  detail: 'Деталь', details: 'Детали', prop: 'Предмет', props: 'Предметы', building_: 'Здание', bag_coins: 'Мешок монет', coin_pile: 'Груда монет',
};

export const TAGS = {
  large: 'крупн.', big: 'крупн.', small: 'мал.', tiny: 'крошечн.', medium: 'средн.', tall: 'выс.', short: 'низк.', long: 'длин.', wide: 'шир.',
  narrow: 'узк.', half: 'половина', quarter: 'четверть', corner: 'угол', corners: 'углы', straight: 'прямой участок', end: 'конец', edge: 'край',
  side: 'бок', top: 'верх', bottom: 'низ', base: 'основание', mid: 'середина', middle: 'середина', center: 'центр', inner: 'внутр.', outer: 'внешн.',
  left: 'лев.', right: 'прав.', front: 'перед', back: 'зад', round: 'кругл.', rounded: 'скругл.', square: 'квадр.', curved: 'изогн.', curve: 'изгиб',
  diagonal: 'диагональ', slope: 'склон', slant: 'скос', sloped: 'наклон', flat: 'плоск.', gable: 'фронтон', point: 'шпиль', peak: 'конёк',
  open: 'откр.', opened: 'откр.', closed: 'закр.', broken: 'сломан.', damaged: 'повреж.', demolished: 'разрушен.', ruined: 'руины', destroyed: 'разрушен.',
  cracked: 'трещины', old: 'стар.', new: 'нов.', decorated: 'украш.', decorative: 'декор', detailed: 'детальн.', simple: 'прост.', fancy: 'нарядн.',
  empty: 'пуст.', full: 'полн.', filled: 'полн.', stacked: 'стопка', stack: 'стопка', pile: 'куча', bundle: 'связка', bundled: 'связка', single: 'одиноч.',
  double: 'двойн.', triple: 'тройн.', multiple: 'несколько', group: 'группа', set: 'набор', pair: 'пара', wood: 'дерево', wooden: 'дерево',
  stone: 'камень', metal: 'металл', iron: 'железо', steel: 'сталь', gold: 'золото', golden: 'золото', silver: 'серебро', copper: 'медь',
  bronze: 'бронза', brick: 'кирпич', plaster: 'штукатурка', thatch: 'солома', tiles: 'черепица', tiled: 'черепица', glass: 'стекло', cloth: 'ткань',
  canvas: 'холст', leather: 'кожа', rope: 'верёвка', dirt: 'земля', sand: 'песок', snow: 'снег', moss: 'мох', mossy: 'мох', autumn: 'осень',
  dead: 'сухое', fall: 'упавш.', fallen: 'упавш.', crooked: 'кривое', twisted: 'кривое', carved: 'резн.', painted: 'краска', paint: 'краска',
  color: 'цветн.', colored: 'цветн.', dark: 'тёмн.', light: 'светл.', red: 'красн.', blue: 'син.', green: 'зелён.', yellow: 'жёлт.', purple: 'фиолет.',
  white: 'бел.', black: 'чёрн.', brown: 'коричн.', grey: 'сер.', gray: 'сер.', orange: 'оранж.', pink: 'розов.', handed: 'хват', '1handed': 'одноручн.',
  '2handed': 'двуручн.', twohanded: 'двуручн.', onehanded: 'одноручн.', modular: 'модуль', variation: 'вариант', variant: 'вариант', alt: 'вариант',
  window_: 'окно', door_: 'дверь', wall_: 'стена', with: '', and: '', on: 'на', string: 'тетива', of: '', the: '', a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F',
  stud: 'опора', studs: 'опоры', fortified: 'укреплён.', pane: 'панель', panel: 'панель', panels: 'панели', screws: 'винты', upgraded: 'улучш.',
  hole: 'дыра', raised: 'приподн.', layer: 'слой', junction: 'развилка', intersection: 'перекрёсток', transition: 'переход', wall: 'стена',
  floor: 'пол', roof: 'крыша', door: 'дверь', window: 'окно', stairs: 'лестница', tower: 'башня', arch: 'арка', gate: 'ворота', fence: 'забор',
  border: 'бордюр', handrail: 'перила', shutters: 'ставни', bars: 'решётка', grate: 'решётка', banner: 'знамя', bottompivot: 'опора внизу',
  low: 'низк.', high: 'выс.', highest: 'выс.', up: 'вверх', down: 'вниз', hanging: 'висяч.', standing: 'стоячий', wallmount: 'на стене', mount: 'крепление',
  farm: 'ферма', twin: 'одноместн.', hexagon: 'шестигран.', withstring: 'с тетивой', badge: 'герб', spikes: 'шипы', barbarian: 'варвар',
  sitting: 'сидя', lying: 'лёжа', idle: 'покой', angry: 'злой', dummy: 'манекен', ornament: 'орнамент', fancy_: 'нарядн.',
};

const split = (s) => s.replace(/\.gltf$|\.glb$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').toLowerCase().split(/[\s_\-.]+/).filter(Boolean);

export function ruName(file) {
  const raw = file.replace(/\.gltf\.glb$|\.gltf$|\.glb$/i, '');
  const whole = raw.toLowerCase().replace(/[\s\-]+/g, '_');
  if (NOUNS[whole]) return NOUNS[whole];
  const t = split(raw);
  let noun = null, ni = -1;
  // первое слово, которое есть среди существительных (пробуем и склейку двух слов: «gravestone», «treestump»)
  for (let i = 0; i < t.length && !noun; i++) {
    const two = t[i] + (t[i + 1] || '');
    if (t[i + 1] && NOUNS[two]) { noun = NOUNS[two]; ni = i; t.splice(i + 1, 1); }
    else if (NOUNS[t[i]] && !/^\d+$/.test(t[i])) { noun = NOUNS[t[i]]; ni = i; }
  }
  const tr = (w) => (/^\d+$/.test(w) ? w : TAGS[w] ?? (NOUNS[w] ? NOUNS[w].toLowerCase() : w));
  if (ni < 0 && t.length) { const w = tr(t[0]) || t[0]; noun = w[0].toUpperCase() + w.slice(1); ni = 0; } // нет существительного — первое слово
  const rest = t.filter((_, i) => i !== ni).map(tr).filter((w) => w !== '');
  const dedup = rest.filter((w, i) => rest.indexOf(w) === i);
  const name = noun || raw;
  return dedup.length ? `${name} (${dedup.join(', ')})` : name;
}

// категория по словам имени (если пак не задал свою): слово целиком или с '*' — по началу слова
const CAT_RULES = [
  ['light', 'torch* candle* lantern* lamp* lightpost* campfire* woodfire* brazier* firebasket chandelier* fire'],
  ['weapon', 'sword* shortsword axe axes bow bows crossbow* shield* dagger* spear* mace* club katana* halberd* helmet* shoulderpads sabre saber rapier flail whip quiver arrow arrows siege* catapult* trebuchet* ballista* ram smokebomb spellbook* wand* staff staffs'],
  ['grave', 'grave* gravestone* gravemarker* tomb* crypt* coffin* skull* bone bones cobweb* web altar* urn* obelisk* pumpkin* scarecrow* cross ribcage cage* shrine* candelabra*'],
  ['nature', 'tree* commontree* pinetree* birchtree* palmtree* deadtree* twistedtree* bush* bushberries rock rocks boulder* grass* tallgrass flower* plant* mushroom* stump* treestump* log logs woodlog* cactus* cactusflower* pine* birch* willow* palm* leaf leaves hedge* lily* lilypad wheat corn cliff* hill hills fern* reed* vine* moss crop crops pebble* petal* clover* branch* pathrocks'],
  ['build', 'wall* floor* roof* door* doorway* window* stair* step steps tower* pillar* column* arch* gate* battlement* bridge* house* building* chimney* balcony* beam* plank planks ceiling* overhang* structure* dock* foundation* mill* windmill* watermill* barn* bigbarn openbarn silo* fence* railing* rail corridor* room* template* trapdoor* tent* stall* fountain* road* tile tiles ground* platform* block* brick bricks shutter* scaffold* support* pole poles ladder* well watertower* chickencoop* hut* cabin* shack* wallcover* towerwindmill'],
];
const RULES = CAT_RULES.map(([c, w]) => [c, w.split(/\s+/).map((x) => (x.endsWith('*') ? [x.slice(0, -1), true] : [x, false]))]);
export function catOf(file, fallback = 'prop') {
  const t = split(file);
  for (const [c, ws] of RULES) if (t.some((tok) => ws.some(([w, pre]) => (pre ? tok.startsWith(w) : tok === w)))) return c;
  return fallback;
}
