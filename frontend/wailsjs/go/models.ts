export namespace main {
	
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
	    }
	}

}

