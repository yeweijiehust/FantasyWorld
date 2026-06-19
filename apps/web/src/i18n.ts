import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const uiLanguages = ["en", "zh"] as const;
export type UiLanguage = (typeof uiLanguages)[number];

const resources = {
  en: {
    translation: {
      nav: {
        world: "World",
        settings: "Settings",
        uiLanguage: "UI language",
        subtitle: "AI world simulation workbench",
        logout: "Logout",
        loading: "Loading FantasyWorld..."
      },
      login: {
        subtitle: "Single-player GM console",
        username: "Username",
        password: "Admin password",
        enter: "Enter",
        signingIn: "Signing in..."
      },
      common: {
        back: "Back",
        next: "Next",
        cancel: "Cancel",
        retry: "Retry",
        revise: "Revise",
        delete: "Delete"
      },
      world: {
        saves: "Saves",
        loadingSaves: "Loading saves...",
        noWorldSelected: "No world selected.",
        mobileDetails: "World details",
        turnSummary: "Turn {{turn}} · {{characters}} chars",
        createHeading: "New world",
        createSteps: "Create world steps",
        stepTemplate: "Template",
        stepWorld: "World",
        stepCast: "Cast",
        stepRules: "Rules",
        stepDraft: "Draft",
        createStartTitle: "Create a world to begin",
        createStartBody:
          "The prototype starts with a generated draft, then lets you advance a mock LLM turn with visible state changes.",
        worldLanguage: "World language",
        worldName: "World name",
        premise: "Premise",
        characterSeeds: "Character seeds",
        characterCount: "{{count}} / 3-8 characters",
        contentBoundary: "Content boundary",
        turnScale: "Turn scale",
        randomness: "Randomness",
        styleGuide: "Style guide",
        modelBaseUrl: "Model base URL",
        modelOverride: "Model override",
        model: "Model",
        generateDraft: "Generate draft",
        draftReady: "Draft ready",
        generationFailed: "Draft generation failed",
        acceptDraft: "Accept draft",
        importJson: "Import JSON",
        importSaveJson: "Import save JSON",
        imported: "Imported",
        invalidJson: "Invalid JSON",
        requiredWorld: "World name and premise are required.",
        requiredCast: "Create 3 to 8 character seeds.",
        export: "Export",
        rollback: "Rollback",
        firstTurnTitle: "The world is waiting for its first turn.",
        firstTurnBody: "Advance once to let characters react to the opening state.",
        gmIntervention: "GM intervention",
        gmPlaceholder: "Let a strange ship arrive at the harbor",
        advanceTurn: "Advance turn",
        advancing: "Advancing...",
        acceptTurn: "Accept turn",
        turnAccepted: "Turn accepted",
        cancelJob: "Cancel job",
        retryJob: "Retry job",
        jobFailed: "Job failed",
        failureReason: "{{code}}: {{message}}",
        usageEstimated: "estimated",
        costNotConfigured: "cost not configured",
        mockReady: "Mock LLM ready",
        draft: "Draft"
      },
      settings: {
        title: "Model settings",
        body: "Prototype calls use a mock provider, but the configuration surface is wired for OpenAI-compatible models.",
        baseUrl: "Base URL",
        model: "Model",
        apiKey: "API key",
        inputTokenPrice: "Input $ / 1M tokens",
        outputTokenPrice: "Output $ / 1M tokens",
        currentKey: "Current key",
        configuredEnding: "configured ending {{tail}}",
        notConfigured: "not configured",
        connectionFailed: "Model connection failed",
        connectionOk: "Connection ok via {{provider}}: JSON {{json}}, usage {{usage}}, stream {{stream}}.",
        yes: "yes",
        no: "no",
        testing: "Testing...",
        save: "Save settings"
      }
    }
  },
  zh: {
    translation: {
      nav: {
        world: "世界",
        settings: "设置",
        uiLanguage: "界面语言",
        subtitle: "AI 世界推演工作台",
        logout: "退出",
        loading: "正在加载 FantasyWorld..."
      },
      login: {
        subtitle: "单人 GM 控制台",
        username: "用户名",
        password: "管理员密码",
        enter: "进入",
        signingIn: "正在进入..."
      },
      common: {
        back: "上一步",
        next: "下一步",
        cancel: "取消",
        retry: "重试",
        revise: "修改",
        delete: "删除"
      },
      world: {
        saves: "存档",
        loadingSaves: "正在加载存档...",
        noWorldSelected: "尚未选择世界。",
        mobileDetails: "世界详情",
        turnSummary: "第 {{turn}} 回合 · {{characters}} 名角色",
        createHeading: "新世界",
        createSteps: "创建世界步骤",
        stepTemplate: "模板",
        stepWorld: "世界",
        stepCast: "角色",
        stepRules: "规则",
        stepDraft: "草稿",
        createStartTitle: "创建一个世界来开始",
        createStartBody: "原型会先生成草稿，然后用可见状态变化推进一次模拟 LLM 回合。",
        worldLanguage: "存档语言",
        worldName: "世界名称",
        premise: "世界前提",
        characterSeeds: "角色种子",
        characterCount: "{{count}} / 3-8 名角色",
        contentBoundary: "内容边界",
        turnScale: "回合尺度",
        randomness: "随机性",
        styleGuide: "风格指南",
        modelBaseUrl: "模型 Base URL",
        modelOverride: "模型覆盖",
        model: "模型",
        generateDraft: "生成草稿",
        draftReady: "草稿已就绪",
        generationFailed: "草稿生成失败",
        acceptDraft: "接受草稿",
        importJson: "导入 JSON",
        importSaveJson: "导入存档 JSON",
        imported: "已导入",
        invalidJson: "无效 JSON",
        requiredWorld: "世界名称和前提不能为空。",
        requiredCast: "请创建 3 到 8 个角色种子。",
        export: "导出",
        rollback: "回滚",
        firstTurnTitle: "世界正在等待第一个回合。",
        firstTurnBody: "推进一次，让角色对开局状态做出反应。",
        gmIntervention: "GM 介入",
        gmPlaceholder: "让一艘陌生船只抵达港口",
        advanceTurn: "推进回合",
        advancing: "推进中...",
        acceptTurn: "接受回合",
        turnAccepted: "回合已接受",
        cancelJob: "取消任务",
        retryJob: "重试任务",
        jobFailed: "任务失败",
        failureReason: "{{code}}：{{message}}",
        usageEstimated: "估算",
        costNotConfigured: "未配置成本",
        mockReady: "Mock LLM 已就绪",
        draft: "草稿"
      },
      settings: {
        title: "模型设置",
        body: "原型默认使用 mock provider，但配置界面已经按 OpenAI-compatible 模型接入。",
        baseUrl: "Base URL",
        model: "模型",
        apiKey: "API key",
        inputTokenPrice: "输入 $ / 百万 tokens",
        outputTokenPrice: "输出 $ / 百万 tokens",
        currentKey: "当前 key",
        configuredEnding: "已配置，尾号 {{tail}}",
        notConfigured: "未配置",
        connectionFailed: "模型连接失败",
        connectionOk: "连接成功：{{provider}}；JSON {{json}}，usage {{usage}}，stream {{stream}}。",
        yes: "是",
        no: "否",
        testing: "测试中...",
        save: "保存设置"
      }
    }
  }
} as const;

function getInitialLanguage(): UiLanguage {
  const stored = localStorage.getItem("fantasyworld.uiLanguage");
  return stored === "zh" || stored === "en" ? stored : "en";
}

void i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false
  }
});

export { i18n };
