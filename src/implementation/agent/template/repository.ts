import { Repository } from "@/application/agent/template/repository";
import { Template } from "@/application/agent/template/model";
import { FileSystem } from "@/application/filesystem/model";

export class FileSystemTemplateRepository implements Repository {
  constructor(
    private fs: FileSystem,
    private dir: string = "config/templates/",
  ) {
    if (!this.dir.endsWith("/")) {
      this.dir += "/";
    }
  }

  static async create(fs: FileSystem, dir = "config/templates/"): Promise<FileSystemTemplateRepository> {
    return new FileSystemTemplateRepository(fs, dir);
  }

  async add(template: Template): Promise<void> {
    await this.fs.writeFile(
      `${this.dir}${template.name}.json`,
      JSON.stringify(template),
    );
  }

  async getByName(name: string): Promise<Template | null> {
    try {
      const content = await this.fs.readFile(`${this.dir}${name}.json`);
      return JSON.parse(content) as Template;
    } catch {
      return null;
    }
  }

  async list(): Promise<Array<Template>> {
    const paths = await this.fs.listFiles(this.dir);
    const fileNames = paths.filter((p) => p.endsWith(".json"));
    const files = await Promise.all(fileNames.map((p) => this.fs.readFile(p)));
    return files.map((c) => JSON.parse(c) as Template);
  }

  async default(): Promise<Template> {
    // todo: we should have a better way to determine the default template, maybe a config file or a specific name
    const templates = await this.list();
    if (templates.length === 0) {
      throw new Error("No templates found");
    }
    return templates[0];
  }
}
