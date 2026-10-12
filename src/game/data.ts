import type { PersonLook } from '../world/characters';
import type { QuestDef } from './questLogic';

export type Home = 'hub' | 'v0' | 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'moon' | 'sky';

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  home: Home;
  look: PersonLook;
  lines: string[];
  nightOnly?: boolean;
  extra?: boolean; // stands at a secondary spot
}

export const NPCS: NpcDef[] = [
  {
    id: 'dodam', name: '도담', title: '바람마루 우체국장', home: 'hub',
    look: { robe: 0x4f6fa8, hat: 'cap', hatColor: 0x3b5687, hair: 0xd9d4cc, scarf: 0xd9665c },
    lines: ['바람이 좋은 날엔 편지도 빨리 날아가지.', '우체국 게시판에 새 의뢰가 붙어 있단다.', '상승기류는 햇볕 좋은 섬 위에서 잘 생긴단다. 꽃잎이 떠오르는 곳을 찾아보렴.'],
  },
  {
    id: 'haru', name: '하루', title: '바람마루 정원사', home: 'hub', extra: true,
    look: { robe: 0x7fae6e, hat: 'straw', hatColor: 0xd9776b },
    lines: ['오늘도 꽃들이 바람에 춤을 춰요.', '바람 강은 반짝이는 줄기로 보여요. 타면 정말 빨라요!', '절벽 끝에서 뛰어내리면 글라이더가 저절로 펼쳐져요.'],
  },
  {
    id: 'bomi', name: '봄이', title: '들꽃마을 꽃집 아이', home: 'v0',
    look: { robe: 0xf2a3b8, hat: 'beret', hatColor: 0xffe27a, hair: 0x8a5a3c, scale: 0.8 },
    lines: ['우리 마을엔 일 년 내내 들꽃이 펴요!', '편지 오는 날이 제일 좋아요.', '바람 조각을 본 적 있어요? 반짝반짝 예쁘대요.'],
  },
  {
    id: 'dandan', name: '단단', title: '솔바람마을 목수', home: 'v1',
    look: { robe: 0x9c6b4a, hat: 'beanie', hatColor: 0x5c7aa8, hair: 0x3b2c22, scale: 1.1 },
    lines: ['튼튼한 다리는 바람에 흔들려도 끊어지지 않지.', '풍차 날개를 새로 깎는 중이야.', '무거운 짐을 질 땐 상승기류를 꼭 타야 해.'],
  },
  {
    id: 'noeul', name: '노을', title: '노을언덕 화가', home: 'v2',
    look: { robe: 0xd98c5c, hat: 'beret', hatColor: 0x6a4f8f, hair: 0x2b2430 },
    lines: ['해 질 녘 하늘 색은 매일 달라요.', '구름바다를 그리려면 하루가 모자라요.', '물감이 깨지지 않게 살살 내려와 주세요.'],
  },
  {
    id: 'pogeun', name: '포근', title: '구름목장 목동', home: 'v3',
    look: { robe: 0xf1e6d2, hat: 'straw', hatColor: 0x7fae6e, hair: 0xb07a4a },
    lines: ['우리 양들은 구름처럼 폭신해요.', '아침 우유는 언제나 신선하답니다.', '바람 방향이 바뀌면 양들이 먼저 알아요.'],
  },
  {
    id: 'byeolha', name: '별하', title: '은하수마을 천문학자', home: 'v4',
    look: { robe: 0x3d4a7a, hat: 'witch', hatColor: 0x2c3560, hair: 0xe8e2d4 },
    lines: ['오늘 밤엔 별이 유난히 밝을 거예요.', '폐허의 기둥들은 별을 보기 위한 시계였대요.', '하늘등대에 불이 다시 켜지면 좋겠어요.'],
  },
  {
    id: 'ujik', name: '우직', title: '메아리골 광부', home: 'v5',
    look: { robe: 0x7a6a5c, hat: 'cap', hatColor: 0xffd35a, hair: 0x3b2c22, scale: 1.15 },
    lines: ['협곡 바위는 해가 들면 뜨거워져서 상승기류가 세지.', '야호~ 메아리가 세 번 돌아온다네.', '폭풍 쪽으로는 함부로 가지 말게.'],
  },
  {
    id: 'seori', name: '서리', title: '눈꽃마을 할아버지', home: 'v6',
    look: { robe: 0xa8c4de, hat: 'beanie', hatColor: 0xd9665c, hair: 0xf3f3f3, scarf: 0xffffff },
    lines: ['눈 덮인 봉우리 위 바람은 차갑지만 정직하지.', '젊을 적엔 나도 배달부였단다.', '높이 오를수록 더 멀리 볼 수 있지.'],
  },
  {
    id: 'eunbit', name: '은빛', title: '달꽃섬 달지기', home: 'moon', nightOnly: true,
    look: { robe: 0xcfd8f2, hat: 'hood', hatColor: 0x8f9fd8, hair: 0xf3f3ff },
    lines: ['달꽃은 밤에만 피어요. 등대 불빛이 길을 알려줄 거예요.', '낮에는 꽃잎 속에서 잠을 자요.', '별빛이 꽃잎에 내려앉는 소리, 들려요?'],
  },
  {
    id: 'ara', name: '아라', title: '하늘등대 등대지기', home: 'sky',
    look: { robe: 0xf4f1ea, hat: 'hood', hatColor: 0xd9665c, hair: 0x5b4636, scarf: 0xffd35a },
    lines: ['폭풍의 눈 한가운데는 언제나 고요해요.', '이 등대가 다시 빛나는 날을 기다렸어요.'],
  },
];

export const QUESTS: QuestDef[] = [
  { id: 'q01', title: '첫 번째 편지', type: 'normal', recipient: 'bomi', cargo: '분홍 봉투', reward: 20,
    briefing: '첫 배달이구나! 들꽃마을의 봄이에게 이 편지를 전해 주렴. 섬 위에서 천천히 다가가면 저절로 내려앉을 거야.',
    thanks: '와아, 할머니 편지다! 고마워요, 배달부님!' },
  { id: 'q02', title: '꽃씨 꾸러미', type: 'normal', recipient: 'pogeun', cargo: '꽃씨 꾸러미', reward: 25,
    briefing: '구름목장의 포근이가 목장에 꽃을 심고 싶다는구나.',
    thanks: '이걸로 목장이 훨씬 예뻐지겠어요. 양들도 좋아할 거예요!' },
  { id: 'q03', title: '목수의 연장', type: 'heavy', recipient: 'dandan', cargo: '연장 상자', reward: 35,
    briefing: '단단에게 보낼 연장 상자야. 꽤 무거우니 상승기류를 타서 고도를 벌어 두렴.',
    thanks: '오, 내 망치! 이걸로 새 다리를 놓을 수 있겠군. 수고했네.' },
  { id: 'q04', title: '따끈한 빵', type: 'express', recipient: 'bomi', cargo: '갓 구운 빵', reward: 35, timeLimit: 120,
    briefing: '빵이 식기 전에! 링을 따라 날아가면 가장 빠른 길이란다.',
    thanks: '아직 따끈따끈해요! 어떻게 이렇게 빨리 왔어요?' },
  { id: 'q05', title: '유리 물감병', type: 'fragile', recipient: 'noeul', cargo: '유리 물감병', reward: 40,
    briefing: '노을언덕의 화가에게 보내는 유리 물감병이야. 급하게 꺾거나 쿵 내려앉으면 깨질 수 있어.',
    thanks: '한 병도 안 깨졌네요! 오늘 노을은 이 색으로 그릴게요.' },
  { id: 'q06', title: '별 지도', type: 'normal', recipient: 'byeolha', cargo: '두루마리 별 지도', reward: 35,
    briefing: '은하수마을의 별하가 기다리던 새 별 지도란다.',
    thanks: '이 지도에 아직 이름 없는 별이 있어요. 배달부님 이름을 붙여도 될까요?' },
  { id: 'q07', title: '양털 이불', type: 'heavy', recipient: 'seori', cargo: '양털 이불', reward: 45,
    briefing: '눈꽃마을은 높은 곳에 있어. 무거운 이불을 들고 가려면 상승기류를 여러 번 타야 할 거야.',
    thanks: '허허, 올겨울은 따뜻하겠구나. 고맙다, 젊은 배달부.' },
  { id: 'q08', title: '광산 도시락', type: 'express', recipient: 'ujik', cargo: '광산 도시락', reward: 45, timeLimit: 150,
    briefing: '우직 아저씨 점심시간이 얼마 안 남았어! 링을 따라 서둘러.',
    thanks: '딱 점심시간에 맞췄구먼! 자네도 한 입 하겠나?' },
  { id: 'q09', title: '달빛 편지', type: 'night', recipient: 'eunbit', cargo: '은빛 봉투', reward: 55,
    briefing: '달꽃섬의 은빛은 밤에만 만날 수 있어. 해가 지면 등대 불빛을 따라가렴. 우체국에서 쉬면서 밤을 기다려도 된단다.',
    thanks: '달이 뜬 밤에 편지라니… 꽃들도 기뻐하고 있어요.' },
  { id: 'q10', title: '도자기 찻잔', type: 'fragile', recipient: 'seori', cargo: '도자기 찻잔', reward: 50,
    briefing: '서리 할아버지가 아끼던 찻잔을 고쳐서 보내는 거야. 조심조심!',
    thanks: '금이 하나도 안 갔구나. 할멈이 쓰던 찻잔이란다. 정말 고맙다.' },
  { id: 'q11', title: '망원경 렌즈', type: 'fragile', recipient: 'byeolha', cargo: '망원경 렌즈', reward: 55,
    briefing: '렌즈는 아주 섬세해. 부드럽게 착지해야 해.',
    thanks: '렌즈가 반짝반짝해요! 오늘 밤엔 토성의 고리도 보이겠어요.' },
  { id: 'q12', title: '급한 약초', type: 'express', recipient: 'pogeun', cargo: '약초 꾸러미', reward: 50, timeLimit: 130,
    briefing: '목장의 아기 양이 아프대. 링을 따라 최대한 빨리!',
    thanks: '이제 아기 양도 괜찮을 거예요. 정말 정말 고마워요!' },
  { id: 'q13', title: '무거운 종', type: 'heavy', recipient: 'ujik', cargo: '청동 종', reward: 60,
    briefing: '메아리골에 새 종을 단다는구나. 협곡의 상승기류는 세니까 잘 이용해 봐.',
    thanks: '이 종소리가 협곡에 세 번 메아리치겠지. 대단하구먼!' },
  { id: 'q14', title: '그림 엽서', type: 'normal', recipient: 'dandan', cargo: '그림 엽서', reward: 35,
    briefing: '노을언덕 화가가 단단에게 보내는 그림 엽서란다.',
    thanks: '노을이 그린 우리 다리로군. 벽에 걸어 둬야겠어.' },
  { id: 'q15', title: '밤의 노래 악보', type: 'night', recipient: 'eunbit', cargo: '악보', reward: 60,
    briefing: '은빛이 달꽃에게 불러 줄 노래 악보야. 밤에만 전할 수 있어.',
    thanks: '♪ 이 노래를 들으면 달꽃이 더 환하게 피어요.' },
  { id: 'q16', title: '얼음 꽃병', type: 'fragile', recipient: 'noeul', cargo: '얼음 꽃병', reward: 60,
    briefing: '눈꽃마을에서 만든 얼음처럼 투명한 꽃병이야. 무엇보다 조심히!',
    thanks: '빛이 꽃병을 통과하는 걸 보세요. 이걸 그려야겠어요!' },
  { id: 'q17', title: '축제 깃발', type: 'heavy', recipient: 'bomi', cargo: '축제 깃발 묶음', reward: 60,
    briefing: '들꽃마을 축제 준비물이야. 묶음이 크고 무거우니 바람을 잘 읽으렴.',
    thanks: '이제 축제를 열 수 있어요! 배달부님도 꼭 놀러 오세요!' },
  { id: 'q18', title: '바람 소식', type: 'express', recipient: 'seori', cargo: '기상 전보', reward: 65, timeLimit: 170,
    briefing: '폭풍이 커지고 있다는 전보야. 서리 할아버지께 서둘러 알려 드려.',
    thanks: '역시… 하늘등대가 꺼진 뒤로 폭풍이 점점 커지는구나.' },
  { id: 'q19', title: '별똥별 조각', type: 'night', recipient: 'byeolha', cargo: '별똥별 조각', reward: 65,
    briefing: '밤에 빛나는 별똥별 조각이야. 별하는 밤에만 이걸 받을 수 있대.',
    thanks: '어둠 속에서 이렇게 빛나다니! 밤까지 기다려 줘서 고마워요.' },
  { id: 'q20', title: '오래된 일기장', type: 'normal', recipient: 'noeul', cargo: '오래된 일기장', reward: 50,
    briefing: '하늘등대 옛 등대지기의 일기장이 발견됐어. 노을이 그 시절 하늘을 그리고 싶어 한단다.',
    thanks: '"폭풍의 눈 한가운데, 등대는 바람의 길을 비춘다"… 아름다운 문장이에요.' },
  { id: 'q21', title: '폭풍 측정기', type: 'heavy', recipient: 'ujik', cargo: '폭풍 측정기', reward: 70,
    briefing: '폭풍을 연구하려는 우직 아저씨의 장비야. 무겁지만 너라면 할 수 있어.',
    thanks: '이걸로 폭풍의 바람 길을 알아낼 수 있겠어. 거의 다 왔네, 배달부!' },
  { id: 'q22', title: '할머니의 답장', type: 'express', recipient: 'dandan', cargo: '답장', reward: 70, timeLimit: 160,
    briefing: '단단이 오래 기다린 답장이란다. 링을 따라 서둘러 주렴.',
    thanks: '드디어 답장이 왔군… 이제 하늘등대로 가는 길에 쓸 다리를 놓을 수 있겠어.' },
  { id: 'q23', title: '하늘등대로 보내는 편지', type: 'final', recipient: 'ara', cargo: '마지막 편지', reward: 200,
    briefing: '이건 모든 섬 사람들이 함께 쓴 편지야. 폭풍의 눈 한가운데 하늘등대의 아라에게 전해 주렴. 폭풍 벽은 거세니 충분히 높이, 빠르게 뚫고 들어가야 해. 업그레이드도 잊지 말고!',
    thanks: '모두의 마음이… 여기 담겨 있어요. 이제 등대에 다시 불을 밝힐게요!' },
];

export const NPC_BY_ID: Record<string, NpcDef> = Object.fromEntries(NPCS.map((n) => [n.id, n]));
