export async function resolveSelectionRange<Uri, Position, Range>(
  uri: Uri,
  position: Position,
  execute: (uri: Uri, positions: Position[]) => PromiseLike<Array<{ range: Range }> | undefined>,
): Promise<Range | undefined> {
  const selectionRanges = await execute(uri, [position]);
  return selectionRanges?.[0]?.range;
}
