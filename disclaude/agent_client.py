"""
Claude Agent SDK compatible wrapper using anthropic library.
"""
import os
import anthropic
from typing import Optional, Mapping, Any, AsyncIterator


class AgentClient:
    """Wrapper for Claude API with GLM support (SDK-compatible interface)."""
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "claude-3-5-sonnet-20241022",
        api_base_url: Optional[str] = None,
        allowed_tools: Optional[tuple] = None,
        workspace: str = "./workspace"
    ):
        """Initialize agent client.
        
        Args:
            api_key: API key for provider
            model: Model name to use (e.g., "claude-3-5-sonnet-20241022" or "glm-4.7")
            api_base_url: Custom API base URL (for GLM: https://open.bigmodel.cn/api/anthropic)
            allowed_tools: Tuple of allowed tool names (for SDK compatibility, not used here)
            workspace: Workspace directory for file operations
        """
        self.api_key = api_key
        self.model = model
        self.api_base_url = api_base_url
        self.allowed_tools = allowed_tools or ()
        self.workspace = workspace
        
        # Ensure workspace exists
        os.makedirs(workspace, exist_ok=True)
        
        # Initialize anthropic client with custom base URL if provided
        if api_base_url:
            self.client = anthropic.Anthropic(
                api_key=api_key,
                base_url=api_base_url
            )
        else:
            self.client = anthropic.Anthropic(api_key=api_key)
    
    def _create_options(self, resume: Optional[str] = None, env: Optional[Mapping[str, str]] = None) -> dict:
        """Create agent options (for SDK compatibility).
        
        Args:
            resume: Optional session ID to resume
            env: Optional environment variables for SDK
        
        Returns:
            Dictionary of options
        """
        options = {
            'model': self.model,
            'api_key': self.api_key,
            'workspace': self.workspace,
        }
        
        if self.api_base_url:
            options['api_base_url'] = self.api_base_url
        
        if resume:
            options['resume'] = resume
        
        if env:
            options['env'] = env
        
        return options
    
    async def query_stream(self, prompt: str, session_id: Optional[str] = None) -> AsyncIterator[Any]:
        """Stream agent response.
        
        Args:
            prompt: User prompt
            session_id: Optional session ID for continuation (not used in this simple version)
        
        Yields:
            Message objects from agent
        """
        # For SDK compatibility, we yield a simple message object with 'content' attribute
        class Message:
            def __init__(self, content):
                self.content = content
        
        try:
            # Call Claude API (non-streaming for simplicity)
            response = self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}]
            )
            
            # Extract response text
            text = response.content[0].text
            
            # Yield as message object
            yield Message(text)
        
        except Exception as e:
            # Yield error message
            yield Message(f"Error: {str(e)}")
    
    def get_env_dict(self) -> Mapping[str, str]:
        """Get environment variables for agent.
        
        Returns:
            Dictionary of environment variables
        """
        env_dict = {
            "ANTHROPIC_API_KEY": self.api_key,
            "ANTHROPIC_MODEL": self.model,
            "WORKSPACE_DIR": self.workspace,
        }
        
        if self.api_base_url:
            env_dict["ANTHROPIC_BASE_URL"] = self.api_base_url
        
        return env_dict
    
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
