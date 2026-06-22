import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const uiLanguages = ["en", "zh"] as const;
export type UiLanguage = (typeof uiLanguages)[number];

const resources = {
  en: {
    translation: {
      nav: {
        world: "World",
        title: "Title",
        load: "Load",
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
      title: {
        kicker: "LLM world simulation",
        body: "Create a living fantasy save, load an existing world, then let the cast think, speak, and act through model-driven turns.",
        createGame: "Create game",
        loadSave: "Load save",
        modelSettings: "Model settings"
      },
      load: {
        kicker: "Saved worlds",
        title: "Load save",
        body: "Choose an existing world or import a save JSON file.",
        importing: "Importing...",
        updatedAt: "Updated {{date}}",
        emptyTitle: "No saves yet",
        emptyBody: "Create a new game or import a save JSON file to begin."
      },
      create: {
        kicker: "New game",
        body: "Set the world, cast, and rules step by step. The generated draft becomes playable only after you accept it.",
        advancedSettings: "Advanced model override"
      },
      world: {
        saves: "Saves",
        loadingSaves: "Loading saves...",
        loadingSave: "Loading save...",
        noWorldSelected: "No world selected.",
        saveLoadFailed: "Save could not be loaded",
        backToTitle: "Back to title",
        loadOtherSave: "Load other save",
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
        generatingDraft: "Generating draft...",
        generationQueued: "Draft generation queued",
        generationRunning: "Generating draft",
        generationPhase: "Phase: {{phase}}",
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
        save: "Save settings",
        healthTitle: "Health",
        healthBody: "App health, model health, and recent LLM call metrics.",
        refreshHealth: "Refresh",
        appHealth: "App",
        appOk: "App ok",
        loadingHealth: "Loading...",
        modelHealth: "Model",
        modelHealthStatus: "Status: {{status}}",
        modelHealthProvider: "Provider: {{provider}}",
        modelHealthModel: "Model: {{model}}",
        modelHealthMetrics: "{{calls}} calls, {{failures}} failures, {{errorRate}} error rate, {{latency}} ms avg",
        runSmokeTest: "Run smoke test",
        smokeTesting: "Testing..."
      }
    }
  },
  zh: {
    translation: {
      nav: {
        world: "世界",
        title: "标题",
        load: "加载",
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
      title: {
        kicker: "LLM 世界推演",
        body: "创建一个会持续演化的幻想存档，或加载已有世界，让角色通过模型驱动的回合进行思考、对话和行动。",
        createGame: "创建游戏",
        loadSave: "加载存档",
        modelSettings: "模型设置"
      },
      load: {
        kicker: "已保存的世界",
        title: "加载存档",
        body: "选择已有世界，或导入一个存档 JSON 文件。",
        importing: "导入中...",
        updatedAt: "更新于 {{date}}",
        emptyTitle: "还没有存档",
        emptyBody: "创建一个新游戏，或导入存档 JSON 来开始。"
      },
      create: {
        kicker: "新游戏",
        body: "一步一步设置世界、角色与规则。生成的草稿只有在你接受后才会变成可游玩的存档。",
        advancedSettings: "高级模型覆盖"
      },
      world: {
        saves: "存档",
        loadingSaves: "正在加载存档...",
        loadingSave: "正在加载存档...",
        noWorldSelected: "尚未选择世界。",
        saveLoadFailed: "存档加载失败",
        backToTitle: "回到标题",
        loadOtherSave: "加载其他存档",
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
        generatingDraft: "正在生成草稿...",
        generationQueued: "草稿生成已排队",
        generationRunning: "正在生成草稿",
        generationPhase: "阶段：{{phase}}",
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
        save: "保存设置",
        healthTitle: "健康状态",
        healthBody: "应用健康、模型健康和最近 LLM 调用指标。",
        refreshHealth: "刷新",
        appHealth: "应用",
        appOk: "应用正常",
        loadingHealth: "加载中...",
        modelHealth: "模型",
        modelHealthStatus: "状态：{{status}}",
        modelHealthProvider: "Provider：{{provider}}",
        modelHealthModel: "模型：{{model}}",
        modelHealthMetrics: "{{calls}} 次调用，{{failures}} 次失败，错误率 {{errorRate}}，平均 {{latency}} ms",
        runSmokeTest: "运行 smoke test",
        smokeTesting: "测试中..."
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
