import { debounce, IconName, moment, Plugin, TFile } from "obsidian";
import OnThisDayPluginSettingTab from "./setting-tab";
import { DEFAULT_SETTINGS, OnThisDayPluginSettings } from "./settings";
import OnThisDaySidePanelView from "./side-panel-view";

type Listener = (notes: TFile[], formattedDate: string) => void;

export default class OnThisDayPlugin extends Plugin {
    static title = "On this day";
    static icon: IconName = "notebook-pen";
    static viewType = "on-this-day-view";
    static openPanelId = "open-on-this-day-panel";
    static openPanelName = "Open panel";
    private static defaultFormat = "YYYY-MM-DD";

    settings: OnThisDayPluginSettings;

    private listeners: Listener[] = [];
    subscribe(listener: Listener) {
        this.listeners.push(listener);
    }
    unsubscribe(listener: Listener) {
        this.listeners.remove(listener);
    }
    emit(notes: TFile[], formattedDate: string) {
        this.listeners.forEach((listener) => listener(notes, formattedDate));
    }

    _folder: string;
    private get folder(): string {
        if (!this._folder)
            this._folder =
                // @ts-expect-error
                this.app.internalPlugins.getPluginById("daily-notes")?.instance
                    ?.options?.folder || "";
        return this._folder;
    }
    _format: string;
    private get format(): string {
        if (!this._format)
            this._format =
                // @ts-expect-error
                this.app.internalPlugins.getPluginById("daily-notes")?.instance
                    ?.options?.format || OnThisDayPlugin.defaultFormat;
        return this._format;
    }

    private get currentDate(): moment.Moment {
        const currentNote = this.app.workspace.getActiveFile();
        return currentNote && this.isDailyNote(currentNote)
            ? moment(currentNote.basename, this.format)
            : moment();
    }

    get formattedDate() {
        return this.currentDate.format(this.format);
    }

    private isDailyNote(note: TFile): boolean {
        return (
            note.extension === "md" &&
            note.path.startsWith(this.folder) &&
            moment(note.basename, this.format).isValid()
        );
    }

    notes: TFile[] = [];
    private getDailyNotes(): TFile[] {
        const { currentDate, format } = this;
        const dailyNotes = this.app.vault
            .getFiles()
            .filter((note) => this.isDailyNote(note))
            .map((note) => ({
                note,
                date: moment(note.basename, format),
            }))
            .filter(({ date }) => {
                return (
                    date.date() === currentDate.date() &&
                    date.month() === currentDate.month()
                );
            })
            .sort((a, b) => b.date.valueOf() - a.date.valueOf())
            .map(({ note }) => note);
        this.notes = dailyNotes;
        return dailyNotes;
    }

    private get leaves() {
        return this.app.workspace.getLeavesOfType(OnThisDayPlugin.viewType);
    }

    private async activateView() {
        const leaves = this.leaves;
        if (leaves.length > 0) {
            leaves.forEach((leaf) => this.app.workspace.revealLeaf(leaf));
            return;
        }

        const rightLeaf = this.app.workspace.getRightLeaf(false);
        if (!rightLeaf) return;
        await rightLeaf.setViewState({
            type: OnThisDayPlugin.viewType,
            active: true,
        });
        this.app.workspace.revealLeaf(rightLeaf);
    }

    private onFileChange(note: TFile | null) {
        if (!(note && this.isDailyNote(note))) return;
        this.refreshViews(true);
    }

    private onContentChange(note: TFile) {
        if (this.leaves.length === 0) return;
        if (!this.isDailyNote(note)) return;
        this.refreshViews();
    }

    refreshViews(reload = false) {
        this.emit(
            reload ? this.getDailyNotes() : this.notes,
            this.formattedDate,
        );
    }

    async onload() {
        await this.loadSettings();

        this.registerView(
            OnThisDayPlugin.viewType,
            (leaf) => new OnThisDaySidePanelView(leaf, this),
        );

        this.registerEvent(
            this.app.workspace.on("file-open", (note) =>
                this.onFileChange(note),
            ),
        );
        this.registerEvent(
            this.app.metadataCache.on("deleted", (note) =>
                this.onFileChange(note),
            ),
        );
        this.registerEvent(
            this.app.metadataCache.on(
                "changed",
                debounce((note) => this.onContentChange(note)),
                1000,
            ),
        );
        this.app.workspace.onLayoutReady(() => this.refreshViews(true));

        this.addCommand({
            id: OnThisDayPlugin.openPanelId,
            name: OnThisDayPlugin.openPanelName,
            callback: async () => await this.activateView(),
        });
        this.addRibbonIcon(
            OnThisDayPlugin.icon,
            OnThisDayPlugin.openPanelName,
            async () => await this.activateView(),
        );

        this.addSettingTab(new OnThisDayPluginSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData(),
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

function getDateFromBasename(basename: string): moment.Moment {
    const patterns: { regex: RegExp; format: string }[] = [
        // 2023-04-02
        { regex: /\d{4}-\d{2}-\d{2}/, format: "YYYY-MM-DD" },

        // April 02, 2023 / April 2, 2023
        {
            regex: /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}/i,
            format: "MMMM D, YYYY",
        },

        // 4_02_23, 04_2_23, etc.
        { regex: /\d{1,2}_\d{1,2}_\d{2}/, format: "M_D_YY" },
    ];

    for (const { regex, format } of patterns) {
        const match = basename.match(regex);
        if (match && match[0]) {
            const dateStr = match[0];
            const m = moment(dateStr, format, true); // strict parse
            if (m.isValid()) {
                return m;
            }
        }
    }

    // Always return a Moment so downstream code never sees null
    return moment.invalid();
}



