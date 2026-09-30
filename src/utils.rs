use nanoid::nanoid;

pub fn new_id() -> String {
    const ALPHABET: [char; 27] = [
        '3', '4', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M',
        'N', 'P', 'Q', 'R', 'T', 'U', 'W', 'X', 'Y',
    ];
    nanoid!(12, &ALPHABET)
}
