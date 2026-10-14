import base64
import asyncio
import io
import os
import tempfile
import unittest
import zipfile


_database_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_database_file.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_database_file.name}"

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import (
    AGENTS,
    STAGE_LABELS,
    AgentConfiguration,
    AgentTask,
    app,
    Project,
    ProjectFile,
    SkillDefinition,
    approved_context,
    create_task_record,
    demo_agent_chat_fallback,
    effective_project_role,
    engine,
    encrypt_model_api_key,
    decrypt_model_api_key,
    hash_password,
    verify_password,
    extract_project_file_text,
    project_file_context,
    model_error_code,
    retryable_model_error,
    require_project_manager,
    require_project_member,
    run_task,
    skill_prompt_content,
    sync_repository_assets,
)
from app.model_gateway import MODEL_PROVIDERS, anthropic_request, gemini_request, ollama_request, provider_defaults


def encoded(payload: bytes) -> str:
    return base64.b64encode(payload).decode("ascii")


class ProjectContextTests(unittest.TestCase):
    def test_text_attachment_is_extracted(self):
        item = ProjectFile(
            id="file-text",
            project_id="project",
            name="research.md",
            mime_type="text/markdown",
            size=12,
            data_base64=encoded("用户反馈：入口难找".encode()),
        )
        content, status = extract_project_file_text(item)
        self.assertEqual(status, "extracted")
        self.assertIn("入口难找", content)

    def test_docx_attachment_is_extracted(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr(
                "word/document.xml",
                '<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>访谈结论</w:t></w:r></w:p></w:body></w:document>',
            )
        payload = buffer.getvalue()
        item = ProjectFile(
            id="file-docx",
            project_id="project",
            name="interview.docx",
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size=len(payload),
            data_base64=encoded(payload),
        )
        content, status = extract_project_file_text(item)
        self.assertEqual(status, "extracted")
        self.assertIn("访谈结论", content)

    def test_context_contains_attachment_source(self):
        with Session(engine) as db:
            project = Project(id="p1", name="项目", problem="足够具体的核心问题", goal="形成评审方案", owner_name="Owner", owner_mis="owner", members=[], member_roles={"owner": "owner"})
            payload = "事实：首单转化下降".encode()
            db.add(project)
            db.add(ProjectFile(id="f1", project_id=project.id, name="facts.txt", mime_type="text/plain", size=len(payload), data_base64=encoded(payload), uploaded_by="Owner"))
            db.commit()
            context = project_file_context(db, project.id)
            shared_context = approved_context(db, project)
        self.assertEqual(context[0]["name"], "facts.txt")
        self.assertEqual(context[0]["extraction_status"], "extracted")
        self.assertIn("首单转化下降", context[0]["content"])
        self.assertEqual(shared_context["context_version"], 1)
        self.assertEqual(shared_context["project_files"][0]["name"], "facts.txt")


class ProjectPermissionTests(unittest.TestCase):
    def setUp(self):
        self.project = Project(id="p", name="项目", problem="足够具体的问题描述", goal="形成方案", owner_name="负责人", owner_mis="owner", members=["member"], member_roles={"owner": "owner", "member": "member"})

    def test_non_member_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            require_project_member(self.project, {"mis": "outsider", "name": "外部用户"})
        self.assertEqual(raised.exception.status_code, 403)

    def test_member_can_read_but_cannot_manage(self):
        require_project_member(self.project, {"mis": "member", "name": "成员"})
        with self.assertRaises(HTTPException) as raised:
            require_project_manager(self.project, {"mis": "member", "name": "成员"})
        self.assertEqual(raised.exception.status_code, 403)

    def test_public_demo_grants_every_user_owner_equivalent_access(self):
        self.project.is_public_demo = True
        outsider = {"mis": "any-user", "name": "任意登录用户"}
        require_project_member(self.project, outsider)
        require_project_manager(self.project, outsider)
        self.assertEqual(effective_project_role(self.project, outsider), "owner")


class AgentRuntimeSafetyTests(unittest.TestCase):
    def test_local_password_hash_is_salted_and_verifiable(self):
        first = hash_password("correct horse battery staple")
        second = hash_password("correct horse battery staple")
        self.assertNotEqual(first, second)
        self.assertTrue(verify_password("correct horse battery staple", first))
        self.assertFalse(verify_password("wrong password", first))

    def test_model_gateway_covers_mainstream_protocols(self):
        self.assertEqual(MODEL_PROVIDERS, {"openai_responses", "openai_chat", "openai_compatible", "azure_openai", "anthropic", "gemini", "ollama"})
        for provider in MODEL_PROVIDERS:
            self.assertTrue(provider_defaults(provider)["base_url"].startswith(("http://", "https://")))

    def test_native_provider_payloads_preserve_system_and_conversation(self):
        messages = [{"role": "system", "content": "规则"}, {"role": "user", "content": "你好"}, {"role": "assistant", "content": "您好"}]
        anthropic = anthropic_request(messages, 128, 0.2)
        self.assertEqual(anthropic["system"], "规则")
        self.assertEqual(anthropic["messages"][1]["role"], "assistant")
        gemini = gemini_request(messages, 128, 0.2)
        self.assertEqual(gemini["systemInstruction"]["parts"][0]["text"], "规则")
        self.assertEqual(gemini["contents"][1]["role"], "model")
        ollama = ollama_request(messages, 128, 0.2)
        self.assertEqual(ollama["options"]["num_predict"], 128)
        self.assertFalse(ollama["stream"])


class LocalAccountTests(unittest.TestCase):
    def test_register_login_session_and_logout(self):
        username = "account-test-user"
        with TestClient(app) as client:
            registered = client.post("/auth/register", json={"username": username, "email": "account-test@example.com", "display_name": "测试用户", "password": "safe-password-123"})
            self.assertEqual(registered.status_code, 200)
            self.assertEqual(registered.json()["data"]["username"], username)
            self.assertNotIn("password", registered.json()["data"])
            self.assertEqual(client.get("/auth/me").status_code, 200)
            configured = client.put("/api/v1/system/model-configuration", json={"provider": "anthropic", "base_url": "https://api.anthropic.com/v1", "model_name": "claude-sonnet-4-5", "api_version": "2023-06-01", "api_key": "test-key"})
            self.assertEqual(configured.status_code, 200)
            self.assertEqual(configured.json()["data"]["provider"], "anthropic")
            self.assertTrue(configured.json()["data"]["has_api_key"])
            self.assertEqual(client.post("/auth/logout").status_code, 200)
            self.assertEqual(client.get("/auth/me").status_code, 401)
            logged_in = client.post("/auth/login", json={"identifier": "account-test@example.com", "password": "safe-password-123"})
            self.assertEqual(logged_in.status_code, 200)

    def test_model_api_key_is_encrypted_and_can_be_recovered(self):
        encrypted = encrypt_model_api_key("sk-test-secret")
        self.assertNotIn("sk-test-secret", encrypted)
        self.assertEqual(decrypt_model_api_key(encrypted), "sk-test-secret")

    def test_model_rate_limit_has_stable_error_code(self):
        class GatewayRateLimit(Exception):
            status_code = 429

        self.assertEqual(model_error_code(GatewayRateLimit("too many requests")), "MODEL_RATE_LIMITED")

    def test_demo_fallback_is_transparent_and_keeps_user_message(self):
        content = demo_agent_chat_fallback("需求洞察 Agent", "你好，请帮我分析这个需求")
        self.assertIn("演示保障模式", content)
        self.assertIn("需求洞察 Agent", content)
        self.assertIn("你好，请帮我分析这个需求", content)

    def test_empty_model_response_is_retryable_for_demo_fallback(self):
        self.assertTrue(retryable_model_error(RuntimeError("MODEL_EMPTY_RESPONSE")))

    def test_skill_prompt_excludes_tests_evals_and_scripts(self):
        skill = SkillDefinition(
            id="skill-safety",
            name="安全 Skill",
            source_name="test",
            content="# 主说明",
            package_files=[
                {"path": "SKILL.md", "size": 8, "kind": "text", "content": "# 主说明"},
                {"path": "assets/input-schema.md", "size": 6, "kind": "text", "content": "输入结构"},
                {"path": "assets/test-cases.md", "size": 6, "kind": "text", "content": "测试业务"},
                {"path": "evals/evals.json", "size": 6, "kind": "text", "content": "评测业务"},
                {"path": "scripts/run.py", "size": 6, "kind": "text", "content": "print(1)"},
            ],
        )
        content, included = skill_prompt_content(skill, 1000)
        self.assertIn("主说明", content)
        self.assertIn("输入结构", content)
        self.assertNotIn("测试业务", content)
        self.assertNotIn("评测业务", content)
        self.assertNotIn("print(1)", content)
        self.assertEqual([item["path"] for item in included], ["SKILL.md", "assets/input-schema.md"])

    def test_duplicate_task_is_reused_and_test_mode_finishes_immediately(self):
        project_id = "task-idempotency"
        with Session(engine) as db:
            project = Project(
                id=project_id,
                name="任务幂等验收",
                problem="用户在项目协作过程中缺少统一上下文",
                goal="形成可评审的协作方案",
                owner_name="Owner",
                owner_mis="owner",
                members=[],
                member_roles={"owner": "owner"},
            )
            db.add(project)
            db.commit()
            first, first_created = create_task_record(db, project, "clarify", "生成需求澄清", "clarify")
            db.flush()
            duplicate, duplicate_created = create_task_record(db, project, "clarify", "重复点击", "clarify")
            self.assertTrue(first_created)
            self.assertFalse(duplicate_created)
            self.assertEqual(first.id, duplicate.id)
            task_id = first.id
            db.commit()

        previous = os.environ.get("AGENT_TEST_MODE")
        os.environ["AGENT_TEST_MODE"] = "1"
        try:
            asyncio.run(run_task(task_id))
        finally:
            if previous is None:
                os.environ.pop("AGENT_TEST_MODE", None)
            else:
                os.environ["AGENT_TEST_MODE"] = previous

        with Session(engine) as db:
            completed = db.get(AgentTask, task_id)
            self.assertEqual(completed.status, "COMPLETED")
            self.assertEqual(completed.runtime, "local-test-template")
            self.assertTrue(completed.run_metadata.get("test_mode"))


class NamingConventionTests(unittest.TestCase):
    def test_builtin_names_and_stage_labels_are_canonical(self):
        self.assertEqual(AGENTS["insight"][0], "需求洞察 Agent")
        self.assertEqual(AGENTS["mrd"][0], "市场需求 Agent")
        self.assertEqual(AGENTS["prd"][0], "产品需求 Agent")
        self.assertEqual(AGENTS["review"][0], "质量评审 Agent")
        self.assertEqual(STAGE_LABELS["MRD"], "市场需求（MRD）")
        self.assertEqual(STAGE_LABELS["PRD"], "产品需求（PRD）")

    def test_repository_sync_migrates_only_known_legacy_names(self):
        with Session(engine) as db:
            insight = db.get(AgentConfiguration, "insight")
            clarify = db.get(AgentConfiguration, "clarify")
            insight.display_name = "洞察分析 Agent"
            insight.identity_md = "# 洞察分析 Agent"
            clarify.display_name = "我的澄清搭档"
            db.flush()

            sync_repository_assets(db)

            self.assertEqual(insight.display_name, "需求洞察 Agent")
            self.assertEqual(insight.identity_md, "# 需求洞察 Agent")
            self.assertEqual(clarify.display_name, "我的澄清搭档")
            db.rollback()

def tearDownModule():
    engine.dispose()
    if os.path.exists(_database_file.name):
        os.unlink(_database_file.name)


if __name__ == "__main__":
    unittest.main()
