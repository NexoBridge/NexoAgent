import React, { useState } from "react";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { useChatStore } from "../../store/chat";

export const ChatPanel: React.FC = () => {
  const { streaming, sendMessage, cancelStream } = useChatStore();
  const [fillValue, setFillValue] = useState<{ text: string; ts: number } | null>(null);
  const [inputText, setInputText] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <MessageList
        onSuggest={(text) => setFillValue({ text, ts: Date.now() })}
        hasInput={inputText.length > 0}
      />
      <InputBar
        onSend={(c, a) => void sendMessage(c, a)}
        disabled={streaming}
        onCancel={cancelStream}
        fillValue={fillValue}
        onValueChange={setInputText}
      />
    </div>
  );
};
