import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let named = false;

  pi.on("session_start", () => {
    named = !!pi.getSessionName();
  });

  pi.on("agent_end", (event) => {
    if (named) return;

    const user = event.messages.find((message) => message.role === "user");
    if (!user) return;

    const text =
      typeof user.content === "string"
        ? user.content
        : user.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join(" ");
    const name = text.replace(/\s+/g, " ").trim().slice(0, 60);

    if (name) {
      pi.setSessionName(name);
      named = true;
    }
  });
}
