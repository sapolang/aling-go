package dict

type DictWord struct {
	Word        string `json:"word"`
	Phonetic    string `json:"phonetic"`
	Translation string `json:"translation"`
	Definition  string `json:"definition"`
	Pos         string `json:"pos"`
	Tag         string `json:"tag"`
}

type DictTag struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}
