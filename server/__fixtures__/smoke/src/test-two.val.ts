import { s, c } from "../val.config";

const schema = s.object({
  name: s.string(),
  enabled: s.boolean(),
  tags: s.array(s.string()),
});

export default c.define("/test-two.val.ts", schema, {
  name: "Test Two",
  enabled: true,
  tags: ["typescript", "testing", "val"],
});
