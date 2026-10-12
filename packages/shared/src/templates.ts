export const TEMPLATE_IDS = ['empty', 'html', 'typescript', 'python', 'c', 'cpp', 'csharp'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export type TemplateFile = {
  path: string
  content: string
}

const TEMPLATES: Record<TemplateId, TemplateFile[]> = {
  empty: [
    { path: 'README.md', content: '# Livebrary Project\n\n빈 프로젝트입니다.\n' },
  ],
  html: [
    {
      path: 'index.html',
      content: '<!DOCTYPE html>\n<html lang="ko">\n<head>\n  <meta charset="utf-8">\n  <title>Livebrary</title>\n  <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n  <h1>Livebrary</h1>\n  <script src="main.js"></script>\n</body>\n</html>\n',
    },
    { path: 'styles.css', content: 'body {\n  margin: 0;\n  font-family: sans-serif;\n}\n' },
    { path: 'main.js', content: 'console.log("Livebrary");\n' },
    { path: 'README.md', content: '# HTML / CSS / JavaScript\n' },
  ],
  typescript: [
    { path: 'src/index.ts', content: 'export function main(): string {\n  return "Livebrary";\n}\n' },
    {
      path: 'tsconfig.json',
      content: '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext",\n    "strict": true\n  },\n  "include": ["src"]\n}\n',
    },
    { path: 'README.md', content: '# TypeScript\n' },
  ],
  python: [
    { path: 'main.py', content: 'def main() -> None:\n    print("Livebrary")\n\n\nif __name__ == "__main__":\n    main()\n' },
    { path: 'README.md', content: '# Python\n' },
  ],
  c: [
    { path: 'main.c', content: '#include <stdio.h>\n\nint main(void) {\n    printf("Livebrary\\n");\n    return 0;\n}\n' },
    { path: 'README.md', content: '# C\n' },
  ],
  cpp: [
    { path: 'main.cpp', content: '#include <iostream>\n\nint main() {\n    std::cout << "Livebrary\\n";\n    return 0;\n}\n' },
    { path: 'README.md', content: '# C++\n' },
  ],
  csharp: [
    {
      path: 'Program.cs',
      content: 'using System;\n\ninternal static class Program {\n    private static void Main() {\n        Console.WriteLine("Livebrary");\n    }\n}\n',
    },
    { path: 'README.md', content: '# C#\n' },
  ],
}

export function isTemplateId(value: string): value is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(value)
}

export function templateFiles(id: string): TemplateFile[] | null {
  if (!isTemplateId(id)) return null
  return TEMPLATES[id].map((file) => ({ ...file }))
}

export const DEFAULT_CHANNELS = ['general', 'development', 'code-review', 'announcements'] as const
