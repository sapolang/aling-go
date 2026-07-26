export namespace dict {
	
	export class DictTag {
	    tag: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new DictTag(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tag = source["tag"];
	        this.count = source["count"];
	    }
	}
	export class DictWord {
	    word: string;
	    phonetic: string;
	    translation: string;
	    definition: string;
	    pos: string;
	    tag: string;
	
	    static createFrom(source: any = {}) {
	        return new DictWord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.word = source["word"];
	        this.phonetic = source["phonetic"];
	        this.translation = source["translation"];
	        this.definition = source["definition"];
	        this.pos = source["pos"];
	        this.tag = source["tag"];
	    }
	}

}

export namespace main {
	
	export class DictAddResult {
	    added: number;
	    skipped: number;
	
	    static createFrom(source: any = {}) {
	        return new DictAddResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.added = source["added"];
	        this.skipped = source["skipped"];
	    }
	}
	export class ImportResult {
	    imported: number;
	    skipped: number;
	
	    static createFrom(source: any = {}) {
	        return new ImportResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.imported = source["imported"];
	        this.skipped = source["skipped"];
	    }
	}
	export class Tag {
	    id: number;
	    name: string;
	    color: string;
	
	    static createFrom(source: any = {}) {
	        return new Tag(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.color = source["color"];
	    }
	}
	export class WhisperStatus {
	    loaded: boolean;
	    loading: boolean;
	    model: string;
	
	    static createFrom(source: any = {}) {
	        return new WhisperStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.loaded = source["loaded"];
	        this.loading = source["loading"];
	        this.model = source["model"];
	    }
	}
	export class Word {
	    id: number;
	    word: string;
	    definition: string;
	    phonetic: string;
	    example: string;
	    tags: string;
	    level: number;
	    next_review: string;
	    created_at: string;
	    updated_at: string;
	    repetitions: number;
	    efactor: number;
	    interval: number;
	
	    static createFrom(source: any = {}) {
	        return new Word(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.word = source["word"];
	        this.definition = source["definition"];
	        this.phonetic = source["phonetic"];
	        this.example = source["example"];
	        this.tags = source["tags"];
	        this.level = source["level"];
	        this.next_review = source["next_review"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	        this.repetitions = source["repetitions"];
	        this.efactor = source["efactor"];
	        this.interval = source["interval"];
	    }
	}

}

