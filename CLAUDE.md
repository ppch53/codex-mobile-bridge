## Local Document Skills

This folder may contain binary Office documents such as `.docx`.

When asked to read or analyze those files in Claude Desktop/Cowork, use the local skills installed at `C:\Users\ppch\.claude\skills` instead of asking the user to convert files manually. For this project:

- For `.docx`, read `C:\Users\ppch\.claude\skills\docx\SKILL.md` and use its Pandoc/Python/XML workflow.
- For `.pdf`, read `C:\Users\ppch\.claude\skills\pdf\SKILL.md`.
- For `.pptx`, read `C:\Users\ppch\.claude\skills\pptx\SKILL.md`.
- For `.xlsx`, read `C:\Users\ppch\.claude\skills\xlsx\SKILL.md`.

Do not stop at "binary files cannot be processed directly" when these local tools are available.
