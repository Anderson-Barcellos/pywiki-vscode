export type AutoExplainState = {
  autoExplain: boolean;
  viewVisible: boolean;
  selectionEmpty: boolean;
  explainOnCursor: boolean;
};

export function shouldScheduleAutoExplain(state: AutoExplainState): boolean {
  return (
    state.autoExplain &&
    state.viewVisible &&
    (!state.selectionEmpty || state.explainOnCursor)
  );
}
