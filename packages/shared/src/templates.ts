import type { CreateSaveInput, Language } from "./schemas.js";

type LocalizedText = Record<Language, string>;

export type WorldTemplate = {
  id: string;
  genre: LocalizedText;
  name: LocalizedText;
  premise: LocalizedText;
  location: {
    name: LocalizedText;
    description: LocalizedText;
    status: LocalizedText;
  };
  characterSeeds: Record<Language, string[]>;
  settings: {
    turnTimeScale: LocalizedText;
    randomness: number;
    contentBoundary: string;
    styleGuide: LocalizedText;
  };
};

export const WORLD_TEMPLATES = [
  {
    id: "fantasy-frontier",
    genre: { zh: "边境奇幻", en: "Frontier fantasy" },
    name: { zh: "雾港纪元", en: "Age of Mist Harbor" },
    premise: {
      zh: "旧王国崩塌后，边境港口正在形成新的权力秩序。",
      en: "After the old kingdom falls, a frontier harbor begins forming a new order of power."
    },
    location: {
      name: { zh: "边境港口", en: "Frontier Harbor" },
      description: {
        zh: "一座夹在贸易、谣言和旧王国阴影之间的港口。",
        en: "A harbor caught between trade, rumor, and the shadow of an old kingdom."
      },
      status: { zh: "平静但暗流涌动", en: "Calm with quiet pressure underneath" }
    },
    characterSeeds: {
      zh: ["艾琳", "赛勒斯", "莫娜"],
      en: ["Aerin", "Cyrus", "Mona"]
    },
    settings: {
      turnTimeScale: { zh: "一幕", en: "One scene" },
      randomness: 25,
      contentBoundary: "PG-13",
      styleGuide: { zh: "一致性优先，保持角色信息差", en: "Prioritize continuity and preserve character secrets" }
    }
  },
  {
    id: "court-intrigue",
    genre: { zh: "宫廷权谋", en: "Court intrigue" },
    name: { zh: "银冠晚宴", en: "The Silver Crown Banquet" },
    premise: {
      zh: "摄政王病倒当夜，所有继承人都被困在王宫晚宴上。",
      en: "On the night the regent falls ill, every heir is trapped inside the royal banquet."
    },
    location: {
      name: { zh: "银冠王宫", en: "Silver Crown Palace" },
      description: {
        zh: "烛光、密信和禁卫军脚步声共同压住了整座宫殿。",
        en: "Candlelight, sealed letters, and guard patrols press down on the palace."
      },
      status: { zh: "封锁中", en: "Locked down" }
    },
    characterSeeds: {
      zh: ["莉赛特", "赫伯特", "娜薇"],
      en: ["Lisette", "Herbert", "Navi"]
    },
    settings: {
      turnTimeScale: { zh: "一小时", en: "One hour" },
      randomness: 18,
      contentBoundary: "PG-13",
      styleGuide: { zh: "强调秘密、误导和政治代价", en: "Emphasize secrets, misdirection, and political cost" }
    }
  },
  {
    id: "skyship-expedition",
    genre: { zh: "飞艇探险", en: "Skyship expedition" },
    name: { zh: "云海测绘局", en: "Cloudsea Survey Bureau" },
    premise: {
      zh: "一艘测绘飞艇发现了移动岛屿的影子，船员必须决定是否偏离航线。",
      en: "A survey skyship spots the shadow of a moving island, forcing the crew to choose whether to leave course."
    },
    location: {
      name: { zh: "测绘飞艇曙光号", en: "Survey Skyship Dawn" },
      description: {
        zh: "甲板下是地图室，甲板上是无边云海和随时会变向的风。",
        en: "Below deck is the map room; above deck are endless clouds and shifting winds."
      },
      status: { zh: "航向不稳", en: "Course unstable" }
    },
    characterSeeds: {
      zh: ["洛柯", "伊莎", "塔文"],
      en: ["Rocco", "Isa", "Tavin"]
    },
    settings: {
      turnTimeScale: { zh: "一段航程", en: "One leg of travel" },
      randomness: 40,
      contentBoundary: "PG",
      styleGuide: { zh: "突出探索、资源压力和船员关系", en: "Focus on discovery, resource pressure, and crew bonds" }
    }
  },
  {
    id: "arcane-academy",
    genre: { zh: "秘法学院", en: "Arcane academy" },
    name: { zh: "星灯档案馆", en: "Star Lantern Archive" },
    premise: {
      zh: "学院档案馆在期末夜醒来，所有被封存的魔法笔记开始改写现实。",
      en: "The academy archive wakes on finals night, and every sealed spell notebook begins rewriting reality."
    },
    location: {
      name: { zh: "星灯档案馆", en: "Star Lantern Archive" },
      description: {
        zh: "书架会移动，灯火会记忆，禁书区正在低声争论谁才是馆长。",
        en: "Shelves move, lanterns remember, and the restricted stacks argue over who runs the archive."
      },
      status: { zh: "魔力过载", en: "Magically overloaded" }
    },
    characterSeeds: {
      zh: ["岚", "维奥", "芙蕾"],
      en: ["Lan", "Vio", "Frey"]
    },
    settings: {
      turnTimeScale: { zh: "一节课", en: "One class period" },
      randomness: 35,
      contentBoundary: "PG",
      styleGuide: { zh: "保持奇妙感，但让规则前后一致", en: "Keep wonder high while making rules consistent" }
    }
  }
] as const satisfies readonly WorldTemplate[];

export function getWorldTemplate(templateId: string): WorldTemplate {
  return WORLD_TEMPLATES.find((template) => template.id === templateId) ?? WORLD_TEMPLATES[0];
}

export function createTemplateSaveInput(templateId: string, language: Language): CreateSaveInput {
  const template = getWorldTemplate(templateId);

  return {
    templateId: template.id,
    name: template.name[language],
    premise: template.premise[language],
    characterSeeds: [...template.characterSeeds[language]],
    settings: {
      language,
      turnTimeScale: template.settings.turnTimeScale[language],
      randomness: template.settings.randomness,
      contentBoundary: template.settings.contentBoundary,
      styleGuide: template.settings.styleGuide[language]
    }
  };
}
