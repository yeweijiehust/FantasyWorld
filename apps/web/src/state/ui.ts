import { create } from "zustand";
import { i18n, type UiLanguage } from "../i18n.js";

type UiState = {
  selectedSaveId: string | undefined;
  uiLanguage: UiLanguage;
  setSelectedSaveId: (selectedSaveId: string | undefined) => void;
  setUiLanguage: (uiLanguage: UiLanguage) => void;
};

const initialLanguage = i18n.language === "zh" || i18n.language === "en" ? i18n.language : "en";

export const useUiStore = create<UiState>((set) => ({
  selectedSaveId: undefined,
  uiLanguage: initialLanguage,
  setSelectedSaveId: (selectedSaveId) => set({ selectedSaveId }),
  setUiLanguage: (uiLanguage) => {
    localStorage.setItem("fantasyworld.uiLanguage", uiLanguage);
    void i18n.changeLanguage(uiLanguage);
    set({ uiLanguage });
  }
}));
