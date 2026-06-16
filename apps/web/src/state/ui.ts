import { create } from "zustand";

type UiState = {
  selectedSaveId: string | undefined;
  setSelectedSaveId: (selectedSaveId: string | undefined) => void;
};

export const useUiStore = create<UiState>((set) => ({
  selectedSaveId: undefined,
  setSelectedSaveId: (selectedSaveId) => set({ selectedSaveId })
}));
