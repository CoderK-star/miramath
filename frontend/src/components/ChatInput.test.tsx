import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatInput } from "@/components/ChatInput";

describe("ChatInput", () => {
  it("sends trimmed text when submit is clicked", () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("数学の質問を入力してください...");
    fireEvent.change(textarea, { target: { value: "  微分を教えて  " } });

    const submit = screen.getByRole("button", { name: "送信" });
    fireEvent.click(submit);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("微分を教えて", undefined);
  });

  it("shows validation message for empty submit", () => {
    render(<ChatInput onSend={vi.fn()} />);

    const textarea = screen.getByPlaceholderText("数学の質問を入力してください...");
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(screen.getByText("メッセージか画像を入力してください")).toBeInTheDocument();
  });
});
