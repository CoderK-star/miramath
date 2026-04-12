from fastapi import HTTPException, Request


async def require_session(request: Request) -> None:
    """全認証保護ルートに適用するセッション確認依存。"""
    if not request.session.get("authenticated"):
        raise HTTPException(status_code=401, detail="未認証です。ログインしてください。")
