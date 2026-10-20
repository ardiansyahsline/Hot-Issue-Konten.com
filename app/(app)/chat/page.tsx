import { getCurrentUser } from "@/lib/auth";
import ChatPage from "@/components/chat/ChatPage";

type SP = Promise<Record<string, string | undefined>>;

export default async function Chat({ searchParams }: { searchParams: SP }) {
  const [{ user }, sp] = await Promise.all([getCurrentUser(), searchParams]);
  const room = sp.room && /^[0-9a-f-]{36}$/i.test(sp.room) ? sp.room : null;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Chat</h1>
        <p className="page-sub">Koordinasi tim — room bersama &amp; pesan pribadi, update langsung tanpa refresh.</p>
      </div>
      <ChatPage meId={user.id} initialRoom={room} />
    </div>
  );
}
