package track

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// What the companion prints or hands to an agent is written in English; the
// phone words what the user reads in its own language, and the agents are told
// to answer in the user's. So no string in the companion's code is in another
// language. Allowed: comments, tests, and the word lists that recognise what a
// user typed (each marked with an "allow: user words" comment on its var).
func TestTheCompanionsTextIsInEnglish(t *testing.T) {
	other := regexp.MustCompile(`[\x{3040}-\x{30ff}\x{3400}-\x{9fff}\x{ac00}-\x{d7af}\x{0400}-\x{04ff}]`)
	root := filepath.Join("..", "..")
	filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() && (d.Name() == "eval" || d.Name() == "testdata") {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return err
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		fs := token.NewFileSet()
		f, err := parser.ParseFile(fs, path, nil, parser.ParseComments)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(f, func(n ast.Node) bool {
			if g, ok := n.(*ast.GenDecl); ok && g.Doc != nil && strings.Contains(g.Doc.Text(), "allow: user words") {
				return false
			}
			if l, ok := n.(*ast.BasicLit); ok && l.Kind == token.STRING && other.MatchString(l.Value) {
				v := l.Value
				if len(v) > 60 {
					v = v[:60] + "…"
				}
				t.Errorf("%s: %s", fs.Position(l.Pos()), v)
			}
			return true
		})
		return nil
	})
}
