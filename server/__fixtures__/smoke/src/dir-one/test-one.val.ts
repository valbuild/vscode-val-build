import { c, s } from "../../val.config";

const schema = s.object({
  title: s.string(),
  description: s.string(),
  count: s.number(),
});

export default c.define("/dir-one/test-one.val.ts", schema, {
  title: "Test One",
  description: "This is the first test module",
  count: 42,
});
