# AI CODING STANDARDS & BEHAVIOR

## 1. ABSOLUTE OUTPUT FORMAT
* **FULL FILES ONLY:** When asked to modify, create, or fix a file, you must output the **ENTIRE** file content from the very first import to the very last line.
* **NO TRUNCATION:** Never shorten the output. Do not stop halfway. If the response length limit is hit, stop explicitly and ask to continue in the next message.
* **NO PLACEHOLDERS:** The use of `...`, `# ... existing code ...`, `# ... rest of file ...`, or similar placeholders is **STRICTLY FORBIDDEN**. You must rewrite every single line of code, even if it hasn't changed.

## 2. CODE FORMATTING
* **STRICT LINE BREAKS:** Do not squash multiple statements onto a single line. Each import and each statement must be on its own line.
* **PEP 8 COMPLIANCE:** Follow standard Python indentation (4 spaces) and formatting rules.
* **READABILITY:** The output must be clean, readable, and identical in structure to a professional source file.

## 3. INTERACTION STYLE
* **COPY-PASTE READY:** Your output is intended to be copied directly into an IDE. It must be a single, complete, valid code block.
* **VERBOSITY:** Prioritize completeness over conciseness in code blocks.

## 4. SYNTAX & WHITESPACE INTEGRITY (CRITICAL)
* **ONE STATEMENT PER LINE:** It is STRICTLY FORBIDDEN to combine multiple statements onto a single line. 
    * **BAD:** `import time import uuid from stuff import thing`
    * **GOOD:** ```python
      import time
      import uuid
      from stuff import thing
      ```
* **DECORATORS:** Decorators (e.g., `@VerbRegistry`) must **ALWAYS** be on their own line, preceding the function or class. Never squash them into the definition line.
* **NO MINIFICATION:** Do not remove vertical whitespace to save space. Output standard, PEP 8 compliant Python code with proper newlines between classes, methods, and imports.

## 5. CONTEXT & DEPENDENCY PROTOCOLS
* **FULL CONTEXT MAPPING:** When providing code, the AI must acknowledge the "Module Map" or "Dependency Tree" provided. Ensure that callbacks between systems (e.g., `UIManager` -> `GameClient`) are never severed or "cleaned up" without explicit instruction.
* **STATE MACHINE PRESERVATION:** Mandatory adherence to the "State Table" of the module. AI must not remove or modify variables tracking game states (Lobby, Countdown, Active Play, Dominion) as these are critical for socket event handling.
* **STRICT BLOCK PROTECTION:** The AI must honor "Strict Block" requests. If told to preserve specific logic from the "Game Concept" document (e.g., Triad Spawns, Unit Data Tables), that code must remain untouched in the full file output.
* **DEBUG SYNC:** AI should cross-reference "Server Debug" logs (Python) with "Browser Console" logs (JavaScript) provided by the user to identify `Uncaught TypeErrors` or failed promises before suggesting a fix.

## 6. LARGE FILE MANAGEMENT
* **CONCERN SEPARATION:** To avoid output limits, focus on files related to specific concerns (e.g., UI files only) when requested.
* **GOLDEN VERSIONS:** Respect "Version Tags." If a block of code is identified as a "Golden Version," the AI must reproduce it exactly as-is in any full-file output to prevent regression.