"""
Test suite for MediCare AI Agent
Tests: configuration, agent initialization, and chat response behavior.
Uses unittest.mock to avoid real Gemini API calls.
"""

import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Minimal agent stub (replace with your real import once the module exists)
# ---------------------------------------------------------------------------

class MediCareAgent:
    """Stub that mirrors the real agent's public interface."""

    DEFAULT_PROMPT = (
        "You are MediCare AI, a professional, friendly, and trustworthy medical "
        "and pharmaceutical assistant created by {org}. You help patients and the "
        "general public with medical guidance, pharmaceutical information, and "
        "healthy lifestyle tips."
    )

    def __init__(self, org_name: str, api_key: str, system_prompt: str = ""):
        if not org_name:
            raise ValueError("Organization name is required.")
        if not api_key:
            raise ValueError("Gemini API key is required.")

        self.org_name = org_name
        self.api_key = api_key
        self.system_prompt = system_prompt or self.DEFAULT_PROMPT.format(org=org_name)
        self._client = None
        self._active = False

    def activate(self):
        """Connects to the Gemini API and marks the agent as active."""
        # Real implementation would create a google.generativeai client here.
        self._client = MagicMock()
        self._active = True

    def chat(self, user_message: str) -> str:
        if not self._active:
            raise RuntimeError("Agent is not activated. Call activate() first.")
        if not user_message.strip():
            raise ValueError("User message cannot be empty.")

        # Real implementation sends user_message to Gemini and returns the reply.
        response = self._client.generate_content(user_message)
        return response.text

    def update_system_prompt(self, new_prompt: str):
        if not new_prompt.strip():
            raise ValueError("System prompt cannot be blank.")
        self.system_prompt = new_prompt

    def deactivate(self):
        self._client = None
        self._active = False


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def valid_agent():
    return MediCareAgent(
        org_name="MediCare Organization",
        api_key="fake-gemini-api-key-12345",
    )


@pytest.fixture
def active_agent(valid_agent):
    valid_agent.activate()
    return valid_agent


# ---------------------------------------------------------------------------
# 1. Configuration / Initialization tests
# ---------------------------------------------------------------------------

class TestAgentInitialization:

    def test_valid_initialization(self, valid_agent):
        assert valid_agent.org_name == "MediCare Organization"
        assert valid_agent.api_key == "fake-gemini-api-key-12345"
        assert "MediCare Organization" in valid_agent.system_prompt

    def test_default_system_prompt_contains_org_name(self, valid_agent):
        assert valid_agent.org_name in valid_agent.system_prompt

    def test_custom_system_prompt_is_used(self):
        custom = "You are a custom medical bot."
        agent = MediCareAgent("Clinic X", "key-abc", system_prompt=custom)
        assert agent.system_prompt == custom

    def test_missing_org_name_raises(self):
        with pytest.raises(ValueError, match="Organization name is required"):
            MediCareAgent(org_name="", api_key="some-key")

    def test_missing_api_key_raises(self):
        with pytest.raises(ValueError, match="Gemini API key is required"):
            MediCareAgent(org_name="Clinic Y", api_key="")

    def test_agent_starts_inactive(self, valid_agent):
        assert valid_agent._active is False


# ---------------------------------------------------------------------------
# 2. Activation / Deactivation tests
# ---------------------------------------------------------------------------

class TestAgentActivation:

    def test_activate_sets_active_flag(self, valid_agent):
        valid_agent.activate()
        assert valid_agent._active is True

    def test_deactivate_clears_client_and_flag(self, active_agent):
        active_agent.deactivate()
        assert active_agent._active is False
        assert active_agent._client is None

    def test_chat_before_activation_raises(self, valid_agent):
        with pytest.raises(RuntimeError, match="not activated"):
            valid_agent.chat("What is paracetamol?")


# ---------------------------------------------------------------------------
# 3. Chat / Response tests (Gemini API mocked)
# ---------------------------------------------------------------------------

class TestAgentChat:

    def test_chat_returns_string_response(self, active_agent):
        active_agent._client.generate_content.return_value = MagicMock(
            text="Paracetamol is used to relieve pain and reduce fever."
        )
        reply = active_agent.chat("What is paracetamol?")
        assert isinstance(reply, str)
        assert "paracetamol" in reply.lower() or "pain" in reply.lower()

    def test_chat_sends_user_message_to_gemini(self, active_agent):
        active_agent._client.generate_content.return_value = MagicMock(text="OK")
        active_agent.chat("Tell me about ibuprofen.")
        active_agent._client.generate_content.assert_called_once_with(
            "Tell me about ibuprofen."
        )

    def test_empty_message_raises(self, active_agent):
        with pytest.raises(ValueError, match="cannot be empty"):
            active_agent.chat("   ")

    def test_whitespace_only_message_raises(self, active_agent):
        with pytest.raises(ValueError):
            active_agent.chat("\n\t")

    def test_medical_query_gets_response(self, active_agent):
        active_agent._client.generate_content.return_value = MagicMock(
            text="Headache can be caused by tension, dehydration, or migraine."
        )
        reply = active_agent.chat("I have a headache, what could cause it?")
        assert len(reply) > 0

    def test_pharma_query_gets_response(self, active_agent):
        active_agent._client.generate_content.return_value = MagicMock(
            text="Amoxicillin is an antibiotic. Dosage: 500mg every 8 hours."
        )
        reply = active_agent.chat("What is the dosage for amoxicillin?")
        assert "amoxicillin" in reply.lower() or "antibiotic" in reply.lower()


# ---------------------------------------------------------------------------
# 4. System prompt update tests
# ---------------------------------------------------------------------------

class TestSystemPromptUpdate:

    def test_update_prompt_saves_new_value(self, valid_agent):
        new_prompt = "You are a specialist in cardiology."
        valid_agent.update_system_prompt(new_prompt)
        assert valid_agent.system_prompt == new_prompt

    def test_blank_prompt_update_raises(self, valid_agent):
        with pytest.raises(ValueError, match="cannot be blank"):
            valid_agent.update_system_prompt("   ")


# ---------------------------------------------------------------------------
# 5. Settings / Save & Activate workflow test
# ---------------------------------------------------------------------------

class TestSaveAndActivateWorkflow:
    """Mirrors the UI flow: fill in org + API key → Save & Activate."""

    def test_full_save_and_activate_workflow(self):
        # User fills in the settings panel
        org = "City General Hospital"
        key = "gemini-key-xyz-9999"

        agent = MediCareAgent(org_name=org, api_key=key)
        agent.activate()

        assert agent._active is True
        assert agent.org_name == org

        # Agent can now accept a chat message
        agent._client.generate_content.return_value = MagicMock(
            text="Here is your health information."
        )
        reply = agent.chat("What are the symptoms of diabetes?")
        assert isinstance(reply, str)
