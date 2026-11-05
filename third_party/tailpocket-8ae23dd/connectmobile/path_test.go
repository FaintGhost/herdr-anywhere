package connectmobile

import "testing"

func TestPathOfAClosedConnection(t *testing.T) {
	if got := Path(987654); got != `{"error":"unknown-handle"}` {
		t.Fatal(got)
	}
}
