// Marks this directory as a Val root for the integration suite. There is no
// node_modules here on purpose: a Val root with no @valbuild/* installed is the
// case the extension must handle by saying nothing at all.
export const config = {
  project: "test/fixture",
};
export const s = {};
export const c = {};
