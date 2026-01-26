"""
Feishu/Lark bot using WebSocket API.
"""
import asyncio
import json
import importlib.util
import logging
from typing import Any

from agent_client import AgentClient
from config import Config

# Check if lark-oapi is available
_LARK_OAPI_AVAILABLE = importlib.util.find_spec("lark_oapi") is not None

if _LARK_OAPI_AVAILABLE:
    import lark_oapi as lark
else:
    lark = None


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class SessionManager:
    """Manage session_id persistence per Feishu chat."""
    
    def __init__(self, persistence_path: str):
        """Initialize session manager.
        
        Args:
            persistence_path: Path to JSON file for persistence.
        """
        self._sessions: dict[str, str] = {}
        self._persistence_path = persistence_path
        self._lock = asyncio.Lock()
    
    async def load_from_file(self):
        """Load sessions from file."""
        try:
            import os
            if os.path.exists(self._persistence_path):
                with open(self._persistence_path, 'r') as f:
                    data = json.load(f)
                    self._sessions = {str(k): str(v) for k, v in data.items()}
                    logger.info(f"Loaded {len(self._sessions)} sessions")
        except Exception as e:
            logger.warning(f"Failed to load sessions: {e}")
            self._sessions = {}
    
    async def save_to_file(self):
        """Save sessions to file."""
        try:
            import os
            os.makedirs(os.path.dirname(self._persistence_path), exist_ok=True)
            with open(self._persistence_path, 'w') as f:
                json.dump(self._sessions, f, indent=2)
        except Exception as e:
            logger.warning(f"Failed to save sessions: {e}")
    
    async def get_session_id(self, chat_id: str) -> str | None:
        """Get session_id for a chat."""
        return self._sessions.get(chat_id)
    
    async def set_session_id(self, chat_id: str, session_id: str):
        """Set session_id for a chat."""
        self._sessions[chat_id] = session_id
        await self.save_to_file()
    
    async def clear_session(self, chat_id: str):
        """Clear session for a chat."""
        if chat_id in self._sessions:
            del self._sessions[chat_id]
            await self.save_to_file()


def _escape_lark_text(text: str) -> str:
    """Escape text for Lark JSON content format."""
    return (
        text.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    )


class FeishuBot:
    """Feishu/Lark bot using WebSocket."""
    
    def __init__(self, agent_client: AgentClient, app_id: str, app_secret: str, session_manager: SessionManager):
        """Initialize Feishu bot.
        
        Args:
            agent_client: Agent client instance
            app_id: Feishu app ID
            app_secret: Feishu app secret
            session_manager: Session manager for persistence
        """
        if not _LARK_OAPI_AVAILABLE:
            raise RuntimeError("lark-oapi is not installed. Install with: pip install lark-oapi")
        
        self.agent_client = agent_client
        self.app_id = app_id
        self.app_secret = app_secret
        self.session_manager = session_manager
        self._running = False
        
        # Lark clients
        self._client: Any = None
        self._ws_client: Any = None
    
    async def _get_client(self) -> Any:
        """Get or create Lark client."""
        assert lark is not None, "lark-oapi is not available"
        
        if self._client is None:
            self._client = (
                lark.Client.builder()
                .app_id(self.app_id)
                .app_secret(self.app_secret)
                .build()
            )
        return self._client
    
    async def _send_message(self, chat_id: str, text: str) -> None:
        """Send a message to Feishu.
        
        Args:
            chat_id: Lark chat ID
            text: Text to send
        """
        assert lark is not None, "lark-oapi is not available"
        
        client = await self._get_client()
        escaped_text = _escape_lark_text(text)
        
        try:
            request = (
                lark.api.im.v1.CreateMessageRequest.builder()
                .receive_id_type("chat_id")
                .request_body(
                    lark.api.im.v1.CreateMessageRequestBody.builder()
                    .receive_id(chat_id)
                    .msg_type("text")
                    .content(f'{{"text":"{escaped_text}"}}')
                    .build()
                )
                .build()
            )
            
            response = client.im.v1.message.create(request)
            if response.code == 0:
                logger.debug(f"Message sent to chat {chat_id}")
            else:
                logger.error(f"Failed to send message: {response.msg} (code={response.code})")
        except Exception as e:
            logger.error(f"Exception sending message to {chat_id}: {e}")
    
    async def _process_agent_message(self, chat_id: str, prompt: str) -> None:
        """Process agent message with streaming response.
        
        Args:
            chat_id: Lark chat ID
            prompt: User prompt
        """
        # Send "Processing..." immediately
        await self._send_message(chat_id, "Processing...")
        
        # Get previous session
        session_id = await self.session_manager.get_session_id(chat_id)
        
        # Accumulate response text
        response_text = ""
        
        try:
            # Stream agent response
            async for message in self.agent_client.query_stream(prompt, session_id):
                # Extract text from message
                text = self._extract_text(message)
                if text:
                    response_text += text
            
            # Send final response
            if response_text:
                await self._send_message(chat_id, response_text)
            
            # Note: session_id is captured via SDK hooks, not returned here
            # For proper session management, you'd need to extend this
            
        except Exception as e:
            logger.error(f"Agent error for chat {chat_id}: {e}")
            await self._send_message(chat_id, f"Error: {e}")
    
    def _extract_text(self, message: Any) -> str:
        """Extract text from agent message.
        
        Args:
            message: Message from agent
        
        Returns:
            Extracted text string
        """
        if hasattr(message, 'content'):
            content = message.content
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts = []
                for block in content:
                    if hasattr(block, 'text'):
                        parts.append(str(block.text))
                return "".join(parts)
        return ""
    
    def _create_event_handler(self) -> Any:
        """Create Lark event handler."""
        assert lark is not None, "lark-oapi is not available"
        
        def handle_message_receive_v1(data: Any) -> None:
            """Handle received message event."""
            if not self._running:
                return

            event = data.event
            message = event.message
            chat_id = message.chat_id
            content_str = message.content
            msg_type = message.message_type

            logger.info(f"[Received] chat_id: {chat_id}, type: {msg_type}")

            # Only handle text messages
            if msg_type != "text":
                return

            # Parse content
            try:
                content = json.loads(content_str)
                text = content.get("text", "").strip()
            except Exception as e:
                logger.error(f"[Error] Failed to parse content: {e}")
                return

            if not text:
                return

            # Schedule async processing
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

            if text.startswith("/"):
                loop.call_soon_threadsafe(lambda: asyncio.create_task(self._handle_command(chat_id, text)))
            else:
                loop.call_soon_threadsafe(lambda: asyncio.create_task(self._process_agent_message(chat_id, text)))
        
        # Build event handler
        event_handler_builder = lark.EventDispatcherHandler.builder("", "")
        event_handler_builder.register_p2_im_message_receive_v1(handle_message_receive_v1)
        
        # Register handlers for other events (suppress logs)
        event_handler_builder.register_p2_im_message_message_read_v1(lambda data: None)
        event_handler_builder.register_p2_im_chat_access_event_bot_p2p_chat_entered_v1(lambda data: None)
        event_handler_builder.register_p2_im_chat_disbanded_v1(lambda data: None)
        
        return event_handler_builder.build()
    
    async def _handle_command(self, chat_id: str, text: str) -> None:
        """Handle slash commands.
        
        Args:
            chat_id: Lark chat ID
            text: Command text
        """
        if text == "/reset" or text == "/clear":
            await self.session_manager.clear_session(chat_id)
            await self._send_message(chat_id, "Session cleared.")
        elif text == "/status":
            session_id = await self.session_manager.get_session_id(chat_id)
            agent_config = Config.get_agent_config()
            status = f"Model: {agent_config['model']}\nSession: {'Active' if session_id else 'None'}"
            await self._send_message(chat_id, status)
        elif text == "/help":
            help_text = (
                "Disclaude Bot\n\n"
                "Commands:\n"
                "/reset - Clear session\n"
                "/status - Show status\n"
                "/help - Show this help\n\n"
                "Just send a message to interact with agent."
            )
            await self._send_message(chat_id, help_text)
        else:
            await self._send_message(chat_id, f"Unknown command: {text}")
    
    async def start(self):
        """Start Feishu WebSocket bot (blocking)."""
        assert lark is not None, "lark-oapi is not available"
        
        # Load sessions
        await self.session_manager.load_from_file()
        
        # Get client
        await self._get_client()
        
        # Create event handler
        event_handler = self._create_event_handler()
        
        # Create WebSocket client
        self._ws_client = lark.ws.Client(
            app_id=self.app_id,
            app_secret=self.app_secret,
            event_handler=event_handler,
        )
        
        self._running = True
        agent_config = Config.get_agent_config()
        logger.info(f"Feishu bot started (model: {agent_config['model']})")
        
        def run_ws_client() -> None:
            """Run WebSocket client in a thread (blocking)."""
            try:
                self._ws_client.start()
            except KeyboardInterrupt:
                logger.info("WebSocket client interrupted.")
            finally:
                self._running = False
        
        try:
            # Run the blocking WebSocket client
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, run_ws_client)
        except KeyboardInterrupt:
            logger.info("Shutting down Feishu bot...")
        finally:
            await self.stop()
    
    async def stop(self):
        """Stop bot."""
        self._running = False
        logger.info("Feishu bot stopped.")
